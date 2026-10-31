import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToolCache } from "../associations/useTool";
import { kmeansFixture } from "../../test/patterns-fixture";
import { KMeansExplorer } from "./KMeansExplorer";

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });

function mockKMeans(respond: (body: { variables: string[]; parameters: Record<string, unknown> }) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/tools/kmeans_clustering")) return respond(JSON.parse(String(init?.body)));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  clearToolCache();
  vi.unstubAllGlobals();
});

describe("KMeansExplorer", () => {
  it("keeps the analysis manual and sends the selected variables and cluster count", async () => {
    const fetchMock = mockKMeans((body) => json(kmeansFixture({}, body.variables, Number(body.parameters.n_clusters))));
    const user = userEvent.setup();
    render(<KMeansExplorer datasetId="dataset-1" numeric={["amount", "price", "margin"]} />);

    expect(screen.getByText("El cálculo no se ejecuta hasta que selecciones las variables y pulses el botón.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("margin"));
    await user.selectOptions(screen.getByLabelText("Número de clusters"), "3");
    await user.click(screen.getByRole("button", { name: "Ejecutar clustering" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      variables: ["amount", "price", "margin"], parameters: { n_clusters: 3 },
    });
  });

  it("renders metrics, clustered points, legend and centroids from a valid response", async () => {
    mockKMeans(() => json(kmeansFixture()));
    const user = userEvent.setup();
    render(<KMeansExplorer datasetId="dataset-1" numeric={["amount", "price"]} />);
    await user.click(screen.getByRole("button", { name: "Ejecutar clustering" }));

    expect(await screen.findByText("12.5")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Proyección de dispersión de price frente a amount, coloreada por cluster" })).toBeInTheDocument();
    expect(screen.getAllByText("Cluster 1").length).toBeGreaterThan(1);
    const table = screen.getByRole("region", { name: "Tabla de clusters" });
    expect(within(table).getByText("Centroide «amount»")).toBeInTheDocument();
    expect(within(table).getAllByRole("rowheader").map((item) => item.textContent)).toEqual(["Cluster 1", "Cluster 2"]);
  });

  it("explains failures, retries, and never keeps a response after changing the configuration", async () => {
    let calls = 0;
    mockKMeans((body) => {
      calls += 1;
      if (calls === 1) return json({ method: "kmeans_clustering", status: "FAILED", warnings: ["boom"], execution_time: 0 });
      return json(kmeansFixture({}, body.variables, Number(body.parameters.n_clusters)));
    });
    const user = userEvent.setup();
    render(<KMeansExplorer datasetId="dataset-1" numeric={["amount", "price", "margin"]} />);
    await user.click(screen.getByRole("button", { name: "Ejecutar clustering" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("falló en el servidor");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("figure", { name: /Proyección de dispersión/ })).toBeInTheDocument();

    await user.click(screen.getByLabelText("margin"));
    expect(screen.getByText("El cálculo no se ejecuta hasta que selecciones las variables y pulses el botón.")).toBeInTheDocument();
    expect(screen.queryByRole("figure", { name: /Proyección de dispersión/ })).not.toBeInTheDocument();
  });
});
