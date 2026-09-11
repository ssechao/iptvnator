import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import {
    WorkspaceShellContextDrawerService,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import { MockProvider } from 'ng-mocks';
import { of, Subject } from 'rxjs';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/ui';
import {
    DataService,
    EpgSourceSettingsService,
    SettingsStore,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    AUTO_UPDATE_PLAYLISTS,
    Language,
    PlaylistMeta,
    Settings,
    StartupBehavior,
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { AppComponent } from './app.component';
import { ElectronServiceStub } from './services/electron.service.stub';
import { SettingsService } from './services/settings.service';

jest.spyOn(global.console, 'error').mockImplementation(() => {
    // suppress console.error output during tests
});

class MockSettingsService {
    getValueFromLocalStorage = jest.fn().mockReturnValue(of(undefined));
    changeTheme = jest.fn();
}

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    epgUrl: [],
    streamFormat: StreamFormat.AutoStreamFormat,
    openStreamOnDoubleClick: false,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
    startupBehavior: StartupBehavior.FirstView,
    showExternalPlaybackBar: true,
    theme: Theme.SystemTheme,
    mpvPlayerPath: '',
    mpvPlayerArguments: '',
    mpvReuseInstance: false,
    vlcPlayerPath: '',
    vlcPlayerArguments: '',
    vlcReuseInstance: false,
    remoteControl: false,
    remoteControlPort: 8765,
    downloadFolder: '',
    recordingFolder: '',
};

describe('AppComponent', () => {
    let component: AppComponent;
    let fixture: ComponentFixture<AppComponent>;
    let epgService: EpgService;
    let router: Router;
    let settingsService: MockSettingsService;
    let snackBar: MatSnackBar;
    let store: MockStore;
    let translateService: TranslateService;
    let runtimeCapabilities: Partial<RuntimeCapabilitiesService>;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    let actionsSubject: Subject<Action>;
    let dataService: DataService;
    let playlistRefreshAction: PlaylistRefreshActionService;

    beforeEach(waitForAsync(() => {
        actionsSubject = new Subject<Action>();
        runtimeCapabilities = {
            isElectron: true,
            isMacOS: false,
        };
        epgBridge = {
            checkFreshness: jest.fn().mockResolvedValue({
                freshUrls: [],
                staleUrls: [],
            }),
            supportsImport: true,
            supportsSourceFreshness: true,
        };

        TestBed.configureTestingModule({
            imports: [AppComponent],
            providers: [
                provideMockStore(),
                {
                    provide: Actions,
                    useFactory: () => new Actions(actionsSubject),
                },
                {
                    provide: DataService,
                    useClass: ElectronServiceStub,
                },
                {
                    provide: SettingsService,
                    useClass: MockSettingsService,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities as RuntimeCapabilitiesService,
                },
                MockProvider(EpgService, {
                    fetchEpg: jest.fn(),
                }),
                MockProvider(PlaylistRefreshActionService, {
                    canRefresh: jest.fn().mockReturnValue(true),
                    refreshNow: jest.fn().mockResolvedValue(true),
                }),
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
                MockProvider(Router, {
                    navigateByUrl: jest.fn(),
                }),
                {
                    // Root-provided in production; stubbed because the spec's
                    // Router mock has no `events` stream for the real service.
                    provide: WorkspaceShellContextDrawerService,
                    useValue: { isOpen: () => false },
                },
                MockProvider(MatSnackBar, {
                    open: jest.fn(),
                }),
                MockProvider(TranslateService, {
                    instant: jest.fn((key: string) => key),
                    setDefaultLang: jest.fn(),
                    use: jest.fn(),
                }),
                {
                    provide: WORKSPACE_SHELL_ACTIONS,
                    useValue: {
                        openAddPlaylistDialog: jest.fn(),
                        openGlobalRecent: jest.fn(),
                        openGlobalSearch: jest.fn(),
                        openAccountInfo: jest.fn(),
                        openStalkerAccountInfo: jest.fn(),
                    },
                },
            ],
        })
            .overrideComponent(AppComponent, {
                set: {
                    template: '',
                },
            })
            .compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(AppComponent);
        epgService = TestBed.inject(EpgService);
        router = TestBed.inject(Router);
        settingsService = TestBed.inject(
            SettingsService
        ) as unknown as MockSettingsService;
        snackBar = TestBed.inject(MatSnackBar);
        store = TestBed.inject(MockStore);
        translateService = TestBed.inject(TranslateService);
        dataService = TestBed.inject(DataService);
        playlistRefreshAction = TestBed.inject(PlaylistRefreshActionService);
        component = fixture.componentInstance;
    });

    afterEach(() => fixture.destroy());

    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    it('should init component', () => {
        const storeDispatchSpy = jest.spyOn(store, 'dispatch');
        jest.spyOn(translateService, 'setDefaultLang');
        jest.spyOn(component, 'initSettings');

        component.ngOnInit();
        expect(storeDispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.loadPlaylists()
        );
        expect(translateService.setDefaultLang).toHaveBeenCalledWith(
            Language.ENGLISH
        );
        expect(component.initSettings).toHaveBeenCalledTimes(1);
    });

    it('auto-updates only playlists whose persisted interval is due', async () => {
        const duePlaylist: PlaylistMeta = {
            _id: 'due',
            title: 'Due source',
            count: 0,
            importDate: '2026-06-09T00:00:00.000Z',
            updateDate: Date.parse('2026-06-10T00:00:00.000Z'),
            autoRefresh: true,
            autoRefreshIntervalHours: 12,
            serverUrl: 'https://provider.example.test',
            username: 'user',
            password: 'password',
        };
        const freshPlaylist: PlaylistMeta = {
            ...duePlaylist,
            _id: 'fresh',
            title: 'Fresh source',
            updateDate: Date.parse('2026-06-10T12:30:00.000Z'),
        };
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-06-10T13:00:00.000Z'));
        store.overrideSelector(selectAllPlaylistsMeta, [
            duePlaylist,
            freshPlaylist,
        ]);
        const refreshNow = jest.spyOn(playlistRefreshAction, 'refreshNow');

        try {
            component.ngOnInit();
            actionsSubject.next(
                PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
            );
            await Promise.resolve();
            await Promise.resolve();

            expect(refreshNow).toHaveBeenCalledWith(duePlaylist);
            expect(refreshNow).not.toHaveBeenCalledWith(freshPlaylist);
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    it('batches due M3U playlists through the Electron auto-update path', async () => {
        const duePlaylist: PlaylistMeta = {
            _id: 'due-m3u',
            title: 'Due M3U source',
            count: 0,
            importDate: '2026-06-09T00:00:00.000Z',
            updateDate: Date.parse('2026-06-10T00:00:00.000Z'),
            autoRefresh: true,
            autoRefreshIntervalHours: 12,
            url: 'https://streams.example.test/playlist.m3u',
        };
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-06-10T13:00:00.000Z'));
        store.overrideSelector(selectAllPlaylistsMeta, [duePlaylist]);
        const sendIpcEvent = jest.spyOn(dataService, 'sendIpcEvent');
        const refreshNow = jest.spyOn(playlistRefreshAction, 'refreshNow');

        try {
            component.ngOnInit();
            actionsSubject.next(
                PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
            );
            await Promise.resolve();
            await Promise.resolve();

            expect(sendIpcEvent).toHaveBeenCalledWith(
                AUTO_UPDATE_PLAYLISTS,
                [duePlaylist]
            );
            expect(refreshNow).not.toHaveBeenCalled();
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    it('rechecks due playlists hourly', async () => {
        jest.useFakeTimers();
        const duePlaylist: PlaylistMeta = {
            _id: 'due',
            title: 'Due source',
            count: 0,
            importDate: '2026-06-09T00:00:00.000Z',
            autoRefresh: true,
            autoRefreshIntervalHours: 12,
            serverUrl: 'https://provider.example.test',
            username: 'user',
            password: 'password',
        };
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-06-10T13:00:00.000Z'));
        store.overrideSelector(selectAllPlaylistsMeta, [duePlaylist]);
        const refreshNow = jest.spyOn(playlistRefreshAction, 'refreshNow');

        try {
            component.ngOnInit();
            actionsSubject.next(
                PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
            );
            await Promise.resolve();
            await Promise.resolve();
            expect(refreshNow).toHaveBeenCalledTimes(1);

            refreshNow.mockClear();
            jest.advanceTimersByTime(59 * 60 * 1000);
            await Promise.resolve();
            expect(refreshNow).not.toHaveBeenCalled();

            jest.advanceTimersByTime(60 * 1000);
            await Promise.resolve();
            await Promise.resolve();
            expect(refreshNow).toHaveBeenCalledTimes(1);
        } finally {
            dateNowSpy.mockRestore();
            jest.useRealTimers();
        }
    });

    it('should navigate to the provided route', () => {
        const route = '/add-playlists';
        jest.spyOn(router, 'navigateByUrl');

        component.navigateToRoute(route);

        expect(router.navigateByUrl).toHaveBeenCalledWith(route);
    });

    it('should apply system theme when no settings are stored', () => {
        jest.spyOn(settingsService, 'changeTheme');

        component.initSettings();

        expect(settingsService.getValueFromLocalStorage).toHaveBeenCalledWith(
            STORE_KEY.Settings
        );
        expect(settingsService.changeTheme).toHaveBeenCalledWith(
            Theme.SystemTheme
        );
    });

    it('should apply saved settings and fetch stale epg data only', async () => {
        const settings: Settings = {
            ...DEFAULT_SETTINGS,
            epgUrl: ['https://example.com/epg.xml'],
            language: Language.SPANISH,
            theme: Theme.DarkTheme,
        };
        epgBridge.checkFreshness = jest.fn().mockResolvedValue({
            freshUrls: [],
            staleUrls: settings.epgUrl,
        });
        settingsService.getValueFromLocalStorage.mockReturnValue(of(settings));
        jest.spyOn(settingsService, 'changeTheme');
        jest.spyOn(translateService, 'use');

        component.initSettings();
        await fixture.whenStable();

        expect(translateService.use).toHaveBeenCalledWith(Language.SPANISH);
        expect(settingsService.changeTheme).toHaveBeenCalledWith(
            Theme.DarkTheme
        );
        expect(epgBridge.checkFreshness).toHaveBeenCalledWith(
            settings.epgUrl,
            12
        );
        expect(epgService.fetchEpg).toHaveBeenCalledWith(settings.epgUrl);
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('does not reimport a deleted source from a late startup freshness response', async () => {
        await TestBed.inject(SettingsStore).loadSettings();
        let finishFreshness!: (value: {
            freshUrls: string[];
            staleUrls: string[];
        }) => void;
        epgBridge.checkFreshness = jest.fn(
            () =>
                new Promise((resolve) => {
                    finishFreshness = resolve;
                })
        );
        const pending = (
            component as unknown as {
                fetchStaleEpgData(urls: string[]): Promise<void>;
            }
        ).fetchStaleEpgData(['https://removed.example/guide.xml']);
        await Promise.resolve();
        const sources = TestBed.inject(EpgSourceSettingsService);
        sources.revision.update((value) => value + 1);
        sources.changed$.next();
        finishFreshness({
            freshUrls: [],
            staleUrls: ['https://removed.example/guide.xml'],
        });
        await pending;
        expect(epgService.fetchEpg).not.toHaveBeenCalledWith([
            'https://removed.example/guide.xml',
        ]);
    });

    it('does not fetch EPG settings when the EPG bridge cannot import EPG', async () => {
        const settings: Settings = {
            ...DEFAULT_SETTINGS,
            epgUrl: ['https://example.com/epg.xml'],
        };
        epgBridge.supportsImport = false;
        settingsService.getValueFromLocalStorage.mockReturnValue(of(settings));

        component.initSettings();
        await fixture.whenStable();

        expect(epgBridge.checkFreshness).not.toHaveBeenCalled();
        expect(epgService.fetchEpg).not.toHaveBeenCalled();
    });
});
