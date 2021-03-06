import {DOCUMENT, isPlatformBrowser} from '@angular/common'
import {HttpClient} from '@angular/common/http'
import {Component, Inject, OnDestroy, PLATFORM_ID, Renderer2} from '@angular/core'
import {ActivatedRoute, Router} from '@angular/router'
import {Store} from '@ngrx/store'
import {fromEvent, merge, Observable, of} from 'rxjs'
import {first, map, mapTo, skipWhile, takeWhile} from 'rxjs/operators'

import {ClientEnvironment, ENVIRONMENT} from '@client/environment'
import {PushNotificationService} from '@client/shared'
import {AuthActions, AuthSelectors, MessagesActions, MessagesSeletors} from '@client/store'
import {SnackbarService} from '@libs/ui-elements/snackbar/snackbar.service'

import {ServiceWorkerService} from './service-worker.service'

enum Theme {
  Light = 'light',
  Dark = 'dark',
}

// FIXME try to auto-recognize google sign in (like on medium or pinterest)
// TODO signin and signout snackbars

@Component({
  selector: 'app-root',
  template: `
    <div class="header saturated">
      <nav>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="logo">
          <path style="fill:#76D275;" d="M144 32 l112 112 -112 112 l-112 -112z" />
          <path style="fill:#43A047;" d="M32 144 v112 l112 112 v-112z" />
          <path style="fill:#76D275;" d="M368 32  l112 112 -112 112 -112 -112z" />
          <path style="fill:#43A047;" d="M480 144 v112 l-112 112 v-112z" />
          <path style="fill:#43A047;" d="M256 144 l112 112 -112 112 -112 -112z" />
          <path style="fill:#00701A;" d="M256 368 v112 l-112 -112  v-112z" />
          <path style="fill:#004300;" d="M256 368 l112 -112 v112 l-112 112z" />
        </svg>

        <div class="menu big">
          <div class="item"><a routerLink="/home" routerLinkActive="selected">Home</a></div>
          <div class="item">
            <a routerLink="/discussions" routerLinkActive="selected">Discussions</a>
            <span class="unread" *ngIf="unreadCount$ | async as count">{{ count }}</span>
          </div>
          <div class="item">
            <a routerLink="/docs" routerLinkActive="selected">Docs</a>
          </div>
        </div>

        <div class="menu small">
          <div class="item">
            <a routerLink="/home" routerLinkActive="selected">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M0 0h24v24H0V0z" fill="none" />
                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5z" />
              </svg>
            </a>
          </div>
          <div class="item">
            <a routerLink="/discussions" routerLinkActive="selected">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M0 0h24v24H0V0z" fill="none" />
                <path d="M22 6h-3v9H6v3h12l4 4V6zm-5 7V2H2v15l4-4h11z" />
              </svg>
            </a>
            <span class="unread" *ngIf="unreadCount$ | async as count">{{ count }}</span>
          </div>
          <div class="item">
            <a routerLink="/docs" routerLinkActive="selected">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M0 0h24v24H0V0z" fill="none" />
                <path d="M19 3H5v18l7-3 7 3V3z" />
              </svg>
            </a>
          </div>
        </div>

        <div class="misc">
          <div class="theme">
            <span class="material-icons icon" *ngIf="!isDarkTheme" (click)="toggleTheme()">
              dark_mode
            </span>
            <span class="material-icons icon" *ngIf="isDarkTheme" (click)="toggleTheme()">
              light_mode
            </span>
          </div>
          <div class="signin" *ngIf="!(user$ | async)"><a (click)="onSignIn()">Sign In</a></div>
          <div class="user" *ngIf="user$ | async as user">
            <img [attr.src]="user.picture" [attr.alt]="'Avatar of ' + user.name" />
          </div>
        </div>
      </nav>
    </div>

    <app-snackbar></app-snackbar>

    <div class="content">
      <router-outlet></router-outlet>
    </div>
  `,
  styleUrls: ['app.component.sass'],
})
export class AppComponent implements OnDestroy {
  offline$: Observable<boolean>
  user$ = this.store.select(AuthSelectors.user)
  unreadCount$ = this.store.select(MessagesSeletors.unreadCount)
  isDarkTheme = false

  private alive = true

  constructor(
    private serviceWorkerService: ServiceWorkerService,
    public notificationService: PushNotificationService,
    private route: ActivatedRoute,
    private store: Store,
    private router: Router,
    private renderer: Renderer2,
    private snackbarService: SnackbarService,
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platform: string,
    @Inject(DOCUMENT) private document: Document,
    @Inject(ENVIRONMENT) private environment: ClientEnvironment,
  ) {
    if (isPlatformBrowser(this.platform)) {
      this.notificationService.initialize()
      this.handleConnectivity()
      this.handleSwUpdates()
      this.handleSignIn()
      this.setTheme()
      this.store.dispatch(MessagesActions.loadExisting())
    }
  }

  ngOnDestroy() {
    this.alive = false
  }

  toggleTheme() {
    this.isDarkTheme = !this.isDarkTheme
    if (this.isDarkTheme) this.setDarkTheme()
    else this.setLightTheme()
  }

  async onSignIn() {
    const {url} = await this.http
      // FIXME dont hardcode api endpoints
      .get<{url: string}>(`${this.environment.api}/sign-in-url`)
      .pipe(first())
      .toPromise()
    window.location.href = url
  }

  private setTheme() {
    const theme = localStorage.getItem('theme')
    if (theme === Theme.Dark) this.setDarkTheme()
    else this.setLightTheme()
  }

  private setDarkTheme() {
    this.renderer.removeClass(this.document.body, Theme.Light)
    this.renderer.addClass(this.document.body, Theme.Dark)
    localStorage.setItem('theme', Theme.Dark)
    this.isDarkTheme = true
  }

  private setLightTheme() {
    this.renderer.removeClass(this.document.body, Theme.Dark)
    this.renderer.addClass(this.document.body, Theme.Light)
    localStorage.setItem('theme', Theme.Light)
    this.isDarkTheme = false
  }

  private handleSignIn() {
    this.route.queryParams
      .pipe(
        skipWhile(value => !value.code),
        map(value => value.code),
        first(),
      )
      .subscribe(code => {
        this.store.dispatch(AuthActions.signIn({code}))
        this.router.navigate([], {relativeTo: this.route, queryParams: {code: undefined}})
      })
  }

  private handleSwUpdates() {
    this.serviceWorkerService.launchUpdateCheckingRoutine()
    this.serviceWorkerService.launchUpdateHandler(() => {
      this.snackbarService.show(
        'An update is available!',
        'Update',
        60 * 60 * 1000,
        'restart_alt',
        () => this.serviceWorkerService.forceUpdateNow(),
      )
    })
  }

  private handleConnectivity() {
    this.offline$ = merge(
      of(!navigator.onLine),
      fromEvent(window, 'online').pipe(mapTo(false)),
      fromEvent(window, 'offline').pipe(mapTo(true)),
    )

    this.offline$.pipe(takeWhile(() => this.alive)).subscribe(isOffline => {
      if (isOffline) this.renderer.addClass(this.document.body, 'offline')
      else this.renderer.removeClass(this.document.body, 'offline')
    })
  }
}
