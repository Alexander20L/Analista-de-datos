import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

test("K-Means runs against the real backend and remains responsive", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByLabel("Archivo del dataset", { exact: true }).setInputFiles(
    fileURLToPath(new URL("../../tests/fixtures/associations.csv", import.meta.url)),
  );
  await page.getByRole("button", { name: "Comprender dataset", exact: true }).click();
  await page.getByRole("link", { name: "Patrones" }).click();

  await expect(page.getByRole("heading", { name: "Patrones por grupo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Segmentación automática — K-Means" })).toBeVisible();
  await expect(page.getByText("El cálculo no se ejecuta hasta que selecciones las variables y pulses el botón.")).toBeVisible();
  await page.getByRole("button", { name: "Ejecutar clustering" }).click();

  await expect(page.getByRole("heading", { name: "Proyección de clusters" })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Proyección de dispersión de/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tabla de clusters" })).toBeVisible();
  await expect(page.getByText("Interpretación y límites")).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.UI_SCREENSHOT_DIR) {
      await page.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, `kmeans-${width}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});
