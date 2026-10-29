import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function signIn(page){
  await page.goto('/');
  await page.getByLabel('Operator passphrase').fill('open-lab-e2e-passphrase');
  await page.getByRole('button',{name:/Open the field notebook/}).click();
  const resetStatus=await page.evaluate(async()=>(await fetch('/api/test/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status);
  if(resetStatus!==200)throw new Error(`Could not isolate browser test (${resetStatus}).`);
  await page.reload();
  await expect(page.getByRole('heading',{name:'A small model, clearly bounded.'})).toBeVisible();
}

test('operator completes a prediction → choose → reveal → learn loop; overlay reveals only on cue',async({page})=>{
  await signIn(page);
  await page.getByRole('button',{name:/Start demo predictions/}).focus();await page.keyboard.press('Enter');
  await expect(page.locator('#phase-tag')).toHaveText('PREDICT');
  const frame=page.frameLocator('#overlay-preview');
  await expect(frame.locator('#phase-label')).toHaveText('PREDICT');
  await page.locator('#demo-voter').selectOption('sample-1');await page.locator('#demo-choice').selectOption('1');await page.getByRole('button',{name:'Add simulated prediction'}).click();
  await expect(page.locator('#prediction-total')).toHaveText('1');
  await page.locator('#demo-voter').selectOption('sample-2');await page.locator('#demo-choice').selectOption('1');await page.getByRole('button',{name:'Add simulated prediction'}).click();
  await page.locator('#demo-voter').selectOption('sample-1');await page.getByRole('button',{name:'Add simulated prediction'}).click();
  await expect(page.locator('#demo-feedback')).toContainText('already-predicted');await expect(page.locator('#prediction-total')).toHaveText('2');
  await page.getByRole('button',{name:'Close predictions'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#phase-tag')).toHaveText('CHOOSE');
  await page.getByLabel(/Mid-tone surface/).focus();await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Run experiment'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#phase-tag')).toHaveText('REVEAL');
  await expect(frame.locator('#result-view')).toBeHidden();
  await page.getByRole('button',{name:'Reveal result'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#phase-tag')).toHaveText('LEARN');
  await expect(page.getByRole('heading',{name:/Tested condition: Mid-tone surface/})).toBeVisible();
  await expect(frame.locator('#result-view')).toBeVisible();
  await expect(frame.locator('#result-assumptions')).toContainText('illustrative');
  await expect(page.locator('#recap-list')).toContainText('Prediction sample: 2');
  await expect(page.locator('#recap-list')).toContainText('Mid-tone surface');
  await page.locator('#recap-list .recap-notes summary').click();
  await expect(page.locator('#recap-list .recap-notes')).toContainText('authored teaching scenarios');
  await expect(page.locator('#export-json')).toHaveAttribute('href','/api/recap/export.json');
});

test('studio phase states and exact transparent overlay pass automated axe checks',async({page})=>{
  await signIn(page);
  const scan=async()=>{const result=await new AxeBuilder({page}).analyze();expect(result.violations.map((violation)=>`${violation.id}: ${violation.help} ${JSON.stringify(violation.nodes.map((node)=>node.target))}`)).toEqual([]);};
  await scan();
  await page.locator('.lesson-disclosure summary').click();await expect(page.locator('.lesson-disclosure')).toHaveAttribute('open','');await scan();
  await page.getByRole('button',{name:/Start demo predictions/}).click();await expect(page.locator('#phase-tag')).toHaveText('PREDICT');await scan();
  await page.getByRole('button',{name:'Close predictions'}).click();await expect(page.locator('#phase-tag')).toHaveText('CHOOSE');await expect(page.locator('#selection-note')).toContainText('No one voted');await scan();
  await page.getByLabel(/Dark surface/).check();await page.getByRole('button',{name:'Run experiment'}).click();await expect(page.locator('#phase-tag')).toHaveText('REVEAL');await scan();
  const overlayPage=await page.context().newPage();await overlayPage.goto('/overlay?preview=1');await expect(overlayPage.locator('#lab-card')).toBeVisible();
  const overlay=await new AxeBuilder({page:overlayPage}).analyze();expect(overlay.violations.map((violation)=>`${violation.id}: ${violation.help}`)).toEqual([]);await overlayPage.close();
  await page.getByRole('button',{name:'Reveal result'}).click();await expect(page.locator('#phase-tag')).toHaveText('LEARN');await scan();
});

test('390px studio and broadcast-sized overlays fit their viewports',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);
  await page.locator('.lesson-disclosure summary').click();
  const dimensions=await page.evaluate(()=>({documentWidth:document.documentElement.scrollWidth,viewportWidth:document.documentElement.clientWidth}));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  const overlay=await page.context().newPage();
  for(const viewport of [{width:1280,height:720},{width:1920,height:1080}]){
    await overlay.setViewportSize(viewport);await overlay.goto('/overlay?preview=1');await expect(overlay.locator('#lab-card')).toBeVisible();
    const layout=await overlay.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,background:getComputedStyle(document.body).backgroundColor}));
    expect(layout.width).toBeLessThanOrEqual(viewport.width);expect(layout.height).toBeLessThanOrEqual(viewport.height);expect(layout.background).toBe('rgba(0, 0, 0, 0)');
  }
  await overlay.close();
});
