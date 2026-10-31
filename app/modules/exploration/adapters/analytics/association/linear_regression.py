"""Explicit, descriptive simple OLS regression over an intake dataset.

The ordered variables are X (independent) and Y (dependent). All metrics use
the same finite complete pairs. Only chart points are sampled; coefficients
and metrics retain full floating-point precision. Equation formatting is for
display only. This tool is registered in exploration, not in the agent workflow.
"""

import numpy as np
from scipy.stats import linregress

from app.modules.exploration.adapters.analytics.base import DatasetTool, ToolOutput
from app.modules.exploration.adapters.analytics.columns import column_array, require_role
from app.modules.exploration.adapters.visualization.charts import ScatterChart, TrendLine
from app.shared.application.errors import AnalysisNotApplicableError, ToolInputError
from app.shared.contracts.datasource import RegisteredDataset
from app.shared.domain.enums.semantic_type import SemanticType
from app.shared.domain.models.analysis import ToolRequest


class LinearRegressionTool(DatasetTool):
    """Fit Y = slope * X + intercept without modifying the registered data."""

    name = "linear_regression"
    min_variables = 2
    max_variables = 2

    def compute(self, data: RegisteredDataset, request: ToolRequest) -> ToolOutput:
        x, y = request.variables
        require_role(data, x, SemanticType.NUMERIC)
        require_role(data, y, SemanticType.NUMERIC)
        xs, ys = column_array(data, x), column_array(data, y)
        if len(xs) != len(ys) or len(xs) != data.dataset.row_count:
            raise ToolInputError("Regression columns have inconsistent row counts.")
        mask = np.isfinite(xs) & np.isfinite(ys)
        xs, ys = xs[mask], ys[mask]
        used = len(xs)
        excluded = len(mask) - used
        self.require_sample(used, f"{x} vs {y}")
        if used < 2:
            raise AnalysisNotApplicableError("Linear regression needs at least 2 valid pairs.")
        if np.all(xs == xs[0]) or np.all(ys == ys[0]):
            raise AnalysisNotApplicableError(
                "Linear regression needs non-constant X and Y among the valid pairs."
            )

        # Overflow/invalid arithmetic is a controlled FAILED outcome in DatasetTool.
        # Do not turn a non-finite coefficient or metric into a plausible number.
        with np.errstate(over="raise", invalid="raise", divide="raise"):
            fit = linregress(xs, ys)
            slope, intercept = float(fit.slope), float(fit.intercept)
            fitted = slope * xs + intercept
            residuals = ys - fitted
            centered_y = ys - np.mean(ys)
            sse = float(np.dot(residuals, residuals))
            sst = float(np.dot(centered_y, centered_y))
            if not np.isfinite([slope, intercept, sse, sst]).all() or sst <= 0:
                raise ValueError("Linear regression produced non-finite or degenerate values.")
            r_squared = 1.0 - sse / sst
            rmse = float(np.sqrt(sse / used))
        if not np.isfinite([r_squared, rmse]).all():
            raise ValueError("Linear regression produced non-finite metrics.")

        notes = [
            "Descriptive linear fit; association does not imply causation. "
            "RMSE is an in-sample error, not an estimate of predictive performance."
        ]
        if excluded:
            notes.append(f"Excluded {excluded} rows with missing or non-finite X or Y.")
        limit = self.options.max_scatter_points
        sampled = used > limit
        if sampled:
            rng = np.random.default_rng(self.options.random_seed)
            keep = np.sort(rng.choice(used, size=limit, replace=False))
            xs, ys = xs[keep], ys[keep]
            fitted, residuals = fitted[keep], residuals[keep]
            notes.append(f"Showing a random sample of {limit} of {used} valid points.")
        chart = ScatterChart(
            x=x,
            y=y,
            points=[(float(a), float(b)) for a, b in zip(xs, ys, strict=True)],
            total_points=used,
            sampled=sampled,
            trend=TrendLine(slope=slope, intercept=intercept),
        )
        return ToolOutput(
            result={
                "x": x,
                "y": y,
                "slope": slope,
                "intercept": intercept,
                "r_squared": r_squared,
                "rmse": rmse,
                "observations_used": used,
                "observations_excluded": excluded,
                "equation": f"ŷ = {slope:.12g} × X {intercept:+.12g}",
                "chart": chart.model_dump(mode="json"),
                "residual_diagnostics": {
                    "kind": "residuals",
                    "x": x,
                    "y": y,
                    "points": [
                        [float(estimate), float(error)]
                        for estimate, error in zip(fitted, residuals, strict=True)
                    ],
                    "total_points": used,
                    "sampled": sampled,
                },
            },
            variables=[x, y],
            sample_size=used,
            warnings=notes,
        )
