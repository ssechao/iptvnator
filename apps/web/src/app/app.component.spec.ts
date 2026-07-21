import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';
import { MockProvider } from 'ng-mocks';
import { of, Subject } from 'rxjs';
import { DataService } from '@iptvnator/services';
import {
    Language,
    Settings,
    StartupBehavior,
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/util';
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
    streamFormat: StreamFormat.M3u8StreamFormat,
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
    let actionsSubject: Subject<any>;
    let playlistRefreshAction: PlaylistRefreshActionService;
    const originalElectron = window.electron;

    beforeEach(waitForAsync(() => {
        actionsSubject = new Subject<any>();

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
                MockProvider(EpgService, {
                    fetchEpg: jest.fn(),
                }),
                MockProvider(Router, {
                    navigateByUrl: jest.fn(),
                }),
                MockProvider(MatSnackBar, {
                    open: jest.fn(),
                }),
                MockProvider(PlaylistRefreshActionService, {
                    canRefresh: jest.fn().mockReturnValue(true),
                    refreshNow: jest.fn().mockResolvedValue(true),
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
        window.electron = {
            checkEpgFreshness: jest.fn().mockResolvedValue({
                freshUrls: [],
                staleUrls: [],
            }),
        } as unknown as typeof window.electron;

        fixture = TestBed.createComponent(AppComponent);
        epgService = TestBed.inject(EpgService);
        router = TestBed.inject(Router);
        settingsService = TestBed.inject(
            SettingsService
        ) as unknown as MockSettingsService;
        snackBar = TestBed.inject(MatSnackBar);
        store = TestBed.inject(MockStore);
        translateService = TestBed.inject(TranslateService);
        playlistRefreshAction = TestBed.inject(PlaylistRefreshActionService);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
        actionsSubject.complete();
        window.electron = originalElectron;
    });

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
        const checkEpgFreshness = jest.fn().mockResolvedValue({
            freshUrls: [],
            staleUrls: settings.epgUrl,
        });

        window.electron = {
            ...window.electron,
            checkEpgFreshness,
        } as unknown as typeof window.electron;
        settingsService.getValueFromLocalStorage.mockReturnValue(of(settings));
        jest.spyOn(settingsService, 'changeTheme');
        jest.spyOn(translateService, 'use');

        component.initSettings();
        await fixture.whenStable();

        expect(translateService.use).toHaveBeenCalledWith(Language.SPANISH);
        expect(settingsService.changeTheme).toHaveBeenCalledWith(
            Theme.DarkTheme
        );
        expect(checkEpgFreshness).toHaveBeenCalledWith(settings.epgUrl, 12);
        expect(epgService.fetchEpg).toHaveBeenCalledWith(settings.epgUrl);
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('refreshes due auto-refresh playlists after playlists load', async () => {
        const duePlaylist = {
            _id: 'playlist-1',
            title: 'Auto Xtream',
            count: 0,
            importDate: '2026-06-09T00:00:00.000Z',
            autoRefresh: true,
            autoRefreshIntervalHours: 12,
            serverUrl: 'http://localhost:8080',
        };
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-06-10T13:00:00.000Z'));
        store.overrideSelector(selectAllPlaylistsMeta, [duePlaylist] as any);

        try {
            component.ngOnInit();
            actionsSubject.next(
                PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
            );
            await Promise.resolve();
            await Promise.resolve();

            expect(playlistRefreshAction.refreshNow).toHaveBeenCalledWith(
                duePlaylist,
                {
                    confirm: false,
                    navigateToPlaylist: true,
                    notify: true,
                }
            );
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    it('checks due auto-refresh playlists hourly after startup', async () => {
        jest.useFakeTimers();
        const duePlaylist = {
            _id: 'playlist-1',
            title: 'Auto Xtream',
            count: 0,
            importDate: '2026-06-09T00:00:00.000Z',
            autoRefresh: true,
            autoRefreshIntervalHours: 12,
            serverUrl: 'http://localhost:8080',
        };
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-06-10T13:00:00.000Z'));
        store.overrideSelector(selectAllPlaylistsMeta, [duePlaylist] as any);

        try {
            component.ngOnInit();
            actionsSubject.next(
                PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
            );
            await Promise.resolve();
            await Promise.resolve();
            expect(playlistRefreshAction.refreshNow).toHaveBeenCalledTimes(1);

            (
                playlistRefreshAction.refreshNow as jest.Mock
            ).mockClear();
            jest.advanceTimersByTime(59 * 60 * 1000);
            await Promise.resolve();
            expect(playlistRefreshAction.refreshNow).not.toHaveBeenCalled();

            jest.advanceTimersByTime(60 * 1000);
            await Promise.resolve();
            await Promise.resolve();
            expect(playlistRefreshAction.refreshNow).toHaveBeenCalledTimes(1);
        } finally {
            dateNowSpy.mockRestore();
            jest.useRealTimers();
        }
    });
});
