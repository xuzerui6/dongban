import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('视觉授权选择、演示计数和陪练状态可用', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/ai/**', route => {
    if (route.request().url().endsWith('/__status')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":false}' })
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(512) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /开始训练/ }).click()

  const cameraStart = page.getByRole('button', { name: /开启 AI 摄像头识别/ })
  await expect(cameraStart).toBeDisabled()
  await page.getByRole('button', { name: '仅本地分析' }).click()
  await expect(cameraStart).toBeEnabled()
  await page.screenshot({ path: join(tmpdir(), `motion-buddy-${testInfo.project.name}-setup.png`) })

  await page.getByRole('button', { name: /使用演示动作/ }).click()
  await expect(page.getByText('姿势稳定', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/兼容模型|本地话术/)).toBeVisible()
  await expect.poll(async () => Number(await page.locator('.rep-count b').textContent()), { timeout: 6_000 }).toBeGreaterThan(0)
  await expect(page.locator('.coach-face')).toBeVisible()
  await page.screenshot({ path: join(tmpdir(), `motion-buddy-${testInfo.project.name}-live.png`) })
  expect(errors).toEqual([])
})
