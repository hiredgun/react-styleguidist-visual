const joi = require('joi')
const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const { getOptions } = require('../utils/options')
const {
  checkForStaleRefScreenshots,
  compareNewScreenshotsToRefScreenshots,
  removeNonRefScreenshots
} = require('../utils/image')
const { getPreviews, takeNewScreenshotsOfPreviews } = require('../utils/page')
const { debug, spinner } = require('../utils/debug')

const testSchema = joi
  .object()
  .unknown()
  .keys({
    url: joi.string().required(),
    dir: joi.string(),
    filter: joi.array().items(joi.string()),
    ignore: joi.array().items(joi.string()),
    threshold: joi
      .number()
      .min(0)
      .max(1),
    wait: joi.number(),
    viewports: joi.object().pattern(
      /^.+$/,
      joi.object().keys({
        width: joi
          .number()
          .integer()
          .min(1),
        height: joi
          .number()
          .integer()
          .min(1),
        deviceScaleFactor: joi
          .number()
          .integer()
          .min(1),
        isMobile: joi.boolean(),
        hasTouch: joi.boolean(),
        isLandscape: joi.boolean()
      })
    ),
    launchOptions: joi.object(),
    connectOptions: joi.object(),
    navigationOptions: joi.object()
  })

const testDefaults = {
  url: undefined,
  sandbox: true,
  dir: 'styleguide-visual',
  filter: undefined,
  ignore: undefined,
  threshold: 0.001,
  wait: 0,
  viewports: {
    desktop: {
      width: 1000,
      height: 600,
      deviceScaleFactor: 1
    }
  },
  launchOptions: {},
  connectOptions: undefined,
  navigationOptions: {}
}

async function test (partialOptions) {
  let browser
  const useConnect = partialOptions.connectOptions !== undefined

  try {
    const options = await getOptions(partialOptions, testDefaults, testSchema)
    const {
      dir,
      filter,
      ignore,
      threshold,
      wait,
      viewports,
      launchOptions,
      connectOptions,
      navigationOptions
    } = options

    let { url } = options
    let entry
    try {
      entry = new URL(url)
    } catch (err) {
      if (!path.isAbsolute(url)) {
        url = path.resolve(url)
      }

      if (fs.lstatSync(url).isFile()) {
        entry = new URL(`file:///${url}`)
      } else {
        throw new Error('Invalid URL arg was provided')
      }
    }

    await removeNonRefScreenshots({ dir, filter, ignore })

    browser = useConnect ? await puppeteer.connect(connectOptions) : await puppeteer.launch(launchOptions)
    const page = await browser.newPage()

    for (const viewport of Object.keys(viewports)) {
      const progress = spinner({
        start: `Taking screenshots for viewport ${viewport}`,
        update: `Taking screenshot of component %s of %s for viewport ${viewport}`,
        stop: `Finished taking screenshots for viewport ${viewport}`
      })
      progress.start()
      await page.setViewport(viewports[viewport])
      const previews = await getPreviews(page, { url: entry.href, filter, ignore, viewport, navigationOptions })
      await takeNewScreenshotsOfPreviews(page, previews, { dir, progress, navigationOptions, wait })
      progress.stop()
    }

    await checkForStaleRefScreenshots({ dir, filter })
    await compareNewScreenshotsToRefScreenshots({ dir, filter, threshold })
  } catch (err) {
    debug(err)
    throw err
  } finally {
    if (useConnect === false && browser != null) {
      await browser.close()
    }
  }
}

module.exports = test
