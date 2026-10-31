import { expect, it } from "vitest";
import { regressionFixture } from "../../test/linear-regression-fixture";
import type { LinearRegressionResult } from "./linear-regression-contract";
import { interpretRegression } from "./linear-regression-interpretation";

const model = (change: Partial<LinearRegressionResult> = {}) => ({
  ...regressionFixture().result as unknown as LinearRegressionResult, ...change,
});

it.each([[2, "aumenta en 2"], [-2, "disminuye en 2"], [0, "La pendiente es cero"]])(
  "la explicación de pendiente %s describe únicamente el valor ajustado", (slope, text) => {
    expect(interpretRegression(model({ slope: Number(slope) }))[0]).toContain(text);
    expect(interpretRegression(model({ slope: Number(slope) }))[0]).toContain("valor ajustado");
  },
);

it("expresa R² como proporción de variación observada y RMSE en unidades de Y", () => {
  const texts = interpretRegression(model());
  expect(texts[1]).toContain("90%");
  expect(texts[1]).toContain("variación observada de «price» en esta muestra");
  expect(texts[2]).toContain("0.5 unidades de «price»");
  expect(texts[2]).toContain("estos mismos datos");
});

it("no presenta un ajuste perfecto como capacidad predictiva", () => {
  const texts = interpretRegression(model({ r_squared: 1, rmse: 0 }));
  expect(texts[1]).toContain("100%");
  expect(texts[2]).toContain("dentro de la precisión numérica");
  expect(texts.join(" ")).not.toMatch(/garantiza|causa|predice/);
});

it.each([0, -Number.EPSILON])("explica R² próximo a cero sin inventar mejora: %s", (r_squared) => {
  expect(interpretRegression(model({ r_squared }))[1]).toContain("recoge poca variación");
});

it("es determinista y no modifica el resultado recibido", () => {
  const result = model(), before = structuredClone(result);
  expect(interpretRegression(result)).toEqual(interpretRegression(result));
  expect(result).toEqual(before);
});

it("usa unidades en singular cuando la pendiente o RMSE valen uno", () => {
  const texts = interpretRegression(model({ slope: 1, rmse: 1 }));
  expect(texts[0]).toContain("aumenta en 1 unidad.");
  expect(texts[2]).toContain("El RMSE es 1 unidad de");
});
