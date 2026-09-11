import {
    Component,
    effect,
    HostBinding,
    inject,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterOutlet } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import {
    WorkspaceShellContextDrawerService,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import { EpgProgressPanelComponent } from '@iptvnator/ui/epg/progress-panel';
import { WindowControlsComponent } from '@iptvnator/ui/components';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/ui';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { take } from 'rxjs';
import {
    DataService,
    RuntimeCapabilitiesService,
    SettingsStore,
    EpgSourceSettingsService,
} from '@iptvnator/services';
import {
    AUTO_UPDATE_PLAYLISTS,
    isPlaylistAutoRefreshDue,
    Language,
    PlaylistMeta,
    Settings,
    STORE_KEY,
    Theme,
    createDevLogger,
} from '@iptvnator/shared/interfaces';
import { SettingsService } from './services/settings.service';
import { PlaybackKeepAwakeService } from './services/playback-keep-awake.service';
import { PlaylistOpenRequestService } from './services/playlist-open-request.service';
import { AppUpdateNotificationPanelComponent } from './app-update-notification-panel.component';
import { AppStartupStatusComponent } from './app-startup-status.component';

const debugAppComponent = createDevLogger('AppComponent');
const AUTO_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000;

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    imports: [
        AppStartupStatusComponent,
        AppUpdateNotificationPanelComponent,
        EpgProgressPanelComponent,
        RouterOutlet,
        WindowControlsComponent,
    ],
})
export class AppComponent implements OnInit, OnDestroy {
    readonly routeReady = signal(false);
    @HostBinding('class.macos-platform') get isMacOS() {
        return this.runtime.isMacOS;
    }
    get usesCustomWindowControls() {
        return this.runtime.usesCustomWindowControls;
    }
    private actions$ = inject(Actions);
    private dataService = inject(DataService);
    private epgBridge = inject(EpgRuntimeBridgeService);
    private epgService = inject(EpgService);
    private snackBar = inject(MatSnackBar);
    private router = inject(Router);
    private store = inject(Store);
    private translate = inject(TranslateService);
    private settingsService = inject(SettingsService);
    private settingsStore = inject(SettingsStore);
    private readonly epgSources = inject(EpgSourceSettingsService);
    private playbackKeepAwake = inject(PlaybackKeepAwakeService);
    private playlistOpenRequests = inject(PlaylistOpenRequestService);
    private runtime = inject(RuntimeCapabilitiesService);
    private readonly workspaceShellActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly contextDrawer = inject(WorkspaceShellContextDrawerService);
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private autoRefreshInFlight = false;
    private autoRefreshTimerId: ReturnType<typeof setInterval> | null = null;

    /** Default language as fallback */
    private readonly DEFAULT_LANG = Language.ENGLISH;

    constructor() {
        // Body-level class (like 'dark-theme') so layout adjustments also
        // reach content rendered outside app-root, e.g. cdk-overlay content.
        if (this.runtime.usesCustomWindowControls) {
            document.body.classList.add('frameless-platform');
        }

        // Playlist files the OS asked us to open (command line argument, file
        // association, macOS `open-file`) are resolved in the main process and
        // queued there until the renderer subscribes. Start listening as early
        // as possible so a first-launch file is not delayed behind app init.
        this.playlistOpenRequests.start();

        // Keep the display awake while a built-in player is playing video
        // (Electron powerSaveBlocker / PWA Screen Wake Lock, issue #1095).
        this.playbackKeepAwake.start();

        effect(() => {
            const size = this.settingsStore.coverSize?.() ?? 'medium';
            document.documentElement.dataset.coverSize = size;
        });

        if (this.runtime.isElectron) {
            document.addEventListener('keydown', (event) => {
                if (event.ctrlKey || event.metaKey) {
                    // While the phone context drawer is modal, workspace
                    // shortcuts must not navigate away behind it — same gate
                    // as Ctrl/Cmd+F, Ctrl/Cmd+K, and the shortcuts dialog.
                    if (this.contextDrawer.isOpen()) {
                        return;
                    }
                    if (event.key === 'r') {
                        event.preventDefault();
                        this.workspaceShellActions.openGlobalRecent();
                    }
                }
            });
        }
    }

    ngOnInit() {
        this.store.dispatch(PlaylistActions.loadPlaylists());
        this.translate.setDefaultLang(this.DEFAULT_LANG);

        this.initSettings();
        this.triggerAutoUpdatePlaylists();
    }

    ngOnDestroy(): void {
        if (this.autoRefreshTimerId) {
            clearInterval(this.autoRefreshTimerId);
            this.autoRefreshTimerId = null;
        }
    }

    /**
     * Reads the settings object from local storage and initializes the
     * application based on them
     */
    initSettings(): void {
        this.settingsService
            .getValueFromLocalStorage<Settings>(STORE_KEY.Settings)
            .subscribe((settings: Settings) => {
                if (settings && Object.keys(settings).length > 0) {
                    // No need to send settings to Electron on init
                    // Settings are stored in IndexedDB and loaded by the settings store
                    // Only specific Electron settings (MPV/VLC paths) are sent when changed in settings component

                    const resolvedLang = settings.language ?? this.DEFAULT_LANG;
                    this.translate.use(resolvedLang);
                    // Mirror the active language to localStorage so the next
                    // cold start can read it synchronously in app.config.ts's
                    // getInitialLanguage() and avoid the English-then-localized
                    // flash for non-English users.
                    try {
                        localStorage.setItem(
                            'iptvnator:preferred-language',
                            resolvedLang
                        );
                    } catch {
                        // Ignore quota / privacy mode errors.
                    }

                    // Fetch EPG if URLs are configured (only fetch stale data)
                    if (
                        this.epgBridge.supportsImport &&
                        settings.epgUrl?.length > 0 &&
                        settings.epgUrl?.some((u) => u !== '')
                    ) {
                        this.fetchStaleEpgData(settings.epgUrl);
                    }

                    if (settings.theme) {
                        this.settingsService.changeTheme(settings.theme);
                    } else {
                        this.detectDarkMode();
                    }
                } else {
                    this.detectDarkMode();
                }
            });
    }

    /**
     * Applies the operating system color scheme when no explicit theme is set
     */
    detectDarkMode(): void {
        this.settingsService.changeTheme(Theme.SystemTheme);
    }

    /**
     * Navigate to the specified route
     * @param route route to navigate to
     */
    navigateToRoute(route: string) {
        this.router.navigateByUrl(route);
    }

    /**
     * Fetches EPG data only for URLs that have stale or missing data.
     * Data is considered fresh if updated within the last 12 hours.
     */
    private async fetchStaleEpgData(urls: string[]): Promise<void> {
        await this.settingsStore.loadSettings();
        const revision = this.epgSources.revision();
        const fetchCurrentSources = async (sources: string[]) => {
            await this.epgSources.waitForReconciliation();
            this.epgService.fetchEpg(
                this.epgSources.retainCurrentSources(sources, revision)
            );
        };
        if (!this.epgBridge.supportsSourceFreshness) {
            await fetchCurrentSources(urls);
            return;
        }

        try {
            const result = await this.epgBridge.checkFreshness(urls, 12);

            if (!result) {
                await fetchCurrentSources(urls);
                return;
            }

            if (result.freshUrls.length > 0) {
                debugAppComponent(
                    `EPG: ${result.freshUrls.length} source(s) already fresh, skipping fetch`
                );
                // Show snackbar if all EPG sources are fresh (no stale URLs)
                if (result.staleUrls.length === 0) {
                    this.snackBar.open(
                        this.translate.instant('EPG.UP_TO_DATE'),
                        this.translate.instant('CLOSE'),
                        { duration: 3000 }
                    );
                }
            }

            if (result.staleUrls.length > 0) {
                debugAppComponent(
                    `EPG: Fetching ${result.staleUrls.length} stale source(s)`
                );
                await fetchCurrentSources(result.staleUrls);
            }
        } catch (error) {
            console.error('Error checking EPG freshness, fetching all:', error);
            // Fallback: fetch all URLs if freshness check fails
            await fetchCurrentSources(urls);
        }
    }

    /** Checks persisted refresh timestamps on startup and then once per hour. */
    private triggerAutoUpdatePlaylists(): void {
        // Wait for playlists to be loaded successfully
        this.actions$
            .pipe(
                ofType(PlaylistActions.loadPlaylistsSuccess),
                take(1) // Only trigger once on app startup
            )
            .subscribe(() => {
                void this.refreshDuePlaylists();
                this.autoRefreshTimerId = setInterval(() => {
                    void this.refreshDuePlaylists();
                }, AUTO_REFRESH_CHECK_INTERVAL_MS);
            });
    }

    private async refreshDuePlaylists(): Promise<void> {
        if (this.autoRefreshInFlight) {
            return;
        }

        this.autoRefreshInFlight = true;
        try {
            const playlists = await new Promise<PlaylistMeta[]>((resolve) => {
                this.store
                    .select(selectAllPlaylistsMeta)
                    .pipe(take(1))
                    .subscribe(resolve);
            });
            const playlistsToUpdate = playlists.filter(
                (playlist) =>
                    isPlaylistAutoRefreshDue(playlist) &&
                    this.playlistRefreshAction.canRefresh(playlist)
            );

            if (playlistsToUpdate.length === 0) {
                return;
            }

            debugAppComponent(
                `Auto-updating ${playlistsToUpdate.length} due playlist(s)`
            );
            const m3uPlaylists = playlistsToUpdate.filter(
                (playlist) => !playlist.serverUrl
            );
            const xtreamPlaylists = playlistsToUpdate.filter(
                (playlist) => Boolean(playlist.serverUrl)
            );

            if (m3uPlaylists.length > 0) {
                await this.dataService.sendIpcEvent(
                    AUTO_UPDATE_PLAYLISTS,
                    m3uPlaylists
                );
            }

            for (const playlist of xtreamPlaylists) {
                await this.playlistRefreshAction.refreshNow(playlist);
            }
        } finally {
            this.autoRefreshInFlight = false;
        }
    }
}
