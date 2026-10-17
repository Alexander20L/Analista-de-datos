import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("member 5 real upload preserves pending stages and retrieves report", async ({ page }) => {
  await page.goto("/report");
  await page.getByLabel("Dataset del reporte").setInputFiles({
    name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from("x,y\n1,2\n3,4\n"),
  });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await expect(page.getByRole("heading", { name: "Estado: SKIPPED" })).toBeVisible();
  await expect(page.getByText("No hay insights respaldados por evidencia disponibles.")).toBeVisible();
  const id = await page.getByLabel("ID de ejecución").inputValue();
  expect(id).toBeTruthy();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar informe" }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("analysis-report.md");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Estado: SKIPPED" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("EDA and a complete report coexist with recovery and downloads", async ({ page }) => {
  test.setTimeout(60_000);
  const rows = ["x,partial_y,control"];
  for (let index = 0; index < 50; index++) {
    const control = Math.floor(index / 5);
    const residual = (index % 5) - 2;
    rows.push(`${control * 10 + residual},${control * 20 - residual},${control}`);
  }
  await page.goto("/");
  await page.getByLabel("Dataset file", { exact: true }).setInputFiles({
    name: "controlled.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n") + "\n"),
  });
  await page.getByRole("button", { name: "Understand Dataset", exact: true }).click();
  await page.getByRole("link", { name: "Explore Associations" }).click();
  const relationships = page.getByRole("region", { name: "Ranked relationships" });
  await expect(relationships.getByText(/x ↔ partial_y|partial_y ↔ x/)).toBeVisible();
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await page.getByLabel("Pregunta del análisis").fill("Evaluar x y partial_y controlando por control.");
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await expect(page.getByRole("heading", { name: "Estado: SUCCESS" })).toBeVisible();
  const runId = await page.getByLabel("ID de ejecución").inputValue();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar JSON" }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe("analysis-report.json");
  const report = JSON.parse(await readFile((await json.path())!, "utf8"));
  expect(report.run_id).toBe(runId);
  expect(report.status).toBe("SUCCESS");
  expect(Object.values(report.stage_statuses)).toEqual(Array(5).fill("SUCCESS"));
  expect(report.evidence.length).toBeGreaterThan(0);
  expect(report.insights.length).toBeGreaterThan(0);
  expect(report.metrics.tokens_used).toBeNull();
  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar informe" }).click();
  const markdown = await markdownDownload;
  expect(await readFile((await markdown.path())!, "utf8")).toContain("SUCCESS");
  await page.getByRole("link", { name: "Associations", exact: true }).click();
  await expect(relationships.getByText(/x ↔ partial_y|partial_y ↔ x/)).toBeVisible();
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await page.reload();
  await page.getByLabel("ID de ejecución").fill(runId);
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Estado: SUCCESS" })).toBeVisible();
  for (const width of [1440, 480, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.UI_SCREENSHOT_DIR) {
      await page.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, `report-${width}.png`), fullPage: true });
    }
  }
});


for (const format of ["csv", "json"]) {
test(`default dated payments (${format}) produce critical evidence and traceable insights`, async ({ page }) => {
  test.setTimeout(90_000);
  const rows = ["Nº contribuyente,Fecha de pago,Distrito del inmueble,Impuesto pagado (S/),Intereses pagados (S/),Total pagado (S/)"];
  for (let i = 0; i < 60; i++) {
    const tax = 500 + i * 10.13 + (i % 2) * 200;
    const interest = (i % 5) * 2.11;
    rows.push(`${2290000 + i},${String(i % 20 + 1).padStart(2, "0")}/03/2026,${i % 2 ? "A" : "B"},${tax.toFixed(2)},${interest.toFixed(2)},${(tax + interest).toFixed(2)}`);
  }
  await page.goto("/");
  await page.getByLabel("Dataset file", { exact: true }).setInputFiles({
    name: `dated-payments.${format}`, mimeType: format === "csv" ? "text/csv" : "application/json",
    buffer: Buffer.from(format === "csv" ? rows.join("\n") + "\n" : JSON.stringify(
      rows.slice(1).map((row) => Object.fromEntries(rows[0].split(",").map((key, i) => [key, row.split(",")[i]]))),
    )),
  });
  await page.getByRole("button", { name: "Understand Dataset", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dataset Overview" })).toBeVisible();
  const profileEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download profile", exact: true }).click();
  const profileFile = await profileEvent;
  const profile = JSON.parse(await readFile((await profileFile.path())!, "utf8"));
  expect(profile.columns.find((item: { column_name: string }) => item.column_name === "Nº contribuyente").semantic_type).toBe("identifier");
  expect(profile.columns.find((item: { column_name: string }) => item.column_name === "Fecha de pago").semantic_type).toBe("temporal");
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await page.getByRole("button", { name: "Generar reporte", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Estado: SUCCESS" })).toBeVisible();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar JSON" }).click();
  const file = await event;
  const report = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(Object.values(report.stage_statuses)).toEqual(Array(5).fill("SUCCESS"));
  expect(report.insights.length).toBeGreaterThan(0);
  expect(report.evidence.length).toBeGreaterThan(0);
  const identity = report.analysis_results.find((item: { method: string }) => item.method === "additive_identity");
  expect(identity.result.identity_confirmed).toBe(true);
  expect(identity.result.matched_rows).toBe(60);
  expect(report.metrics.tokens_used).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

}
