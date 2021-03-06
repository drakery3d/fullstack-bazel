import {browser, logging} from 'protractor'

import {AppPage} from './app.po'

describe('Angular Client', () => {
  let page: AppPage

  beforeEach(() => {
    page = new AppPage()
  })

  it('displays title message', async () => {
    await page.navigateTo()
    const title = await page.getTitleText()
    expect(title).toEqual('Fullstack Bazel')
  })

  afterEach(async () => {
    const logs = await browser.manage().logs().get(logging.Type.BROWSER)
    expect(logs).not.toContain(
      jasmine.objectContaining({
        level: logging.Level.SEVERE,
      } as logging.Entry),
    )
  })
})
