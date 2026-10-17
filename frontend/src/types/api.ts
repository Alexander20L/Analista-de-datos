// Generated from FastAPI OpenAPI. Run npm run generate:api; do not edit.
export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description Process liveness; does not assert analytical readiness.
         */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/analysis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Analysis
         * @description Local development contract. Pending stages remain explicitly SKIPPED.
         */
        post: operations["analysis_analysis_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/analysis/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Analysis Upload */
        post: operations["analysis_upload_analysis_upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Report */
        get: operations["report_reports__run_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/{run_id}/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Report Metrics */
        get: operations["report_metrics_reports__run_id__metrics_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/{run_id}/markdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Report Markdown */
        get: operations["report_markdown_reports__run_id__markdown_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/intake": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Intake
         * @description Translate multipart HTTP input to the framework-independent intake use case.
         */
        post: operations["intake_intake_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Tools */
        get: operations["tools_tools_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/datasets/{dataset_id}/tools/{tool_name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run Tool
         * @description SKIPPED/FAILED tool outcomes are returned with 200; they are analysis results.
         */
        post: operations["run_tool_datasets__dataset_id__tools__tool_name__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AnalysisConfiguration */
        AnalysisConfiguration: {
            analysis?: components["schemas"]["AnalysisOverrides"];
            performance?: components["schemas"]["PerformanceOverrides"];
        };
        /** AnalysisInput */
        AnalysisInput: {
            /** Source */
            source: components["schemas"]["CsvSourceSpec"] | components["schemas"]["TsvSourceSpec"] | components["schemas"]["JsonSourceSpec"] | components["schemas"]["TextSourceSpec"] | components["schemas"]["SqlSourceSpec"];
            schema?: components["schemas"]["DatasetSchema"] | null;
            data_dictionary?: components["schemas"]["DataDictionary"] | null;
            /** User Question */
            user_question?: string | null;
            configuration?: components["schemas"]["AnalysisConfiguration"];
        };
        /** AnalysisOverrides */
        AnalysisOverrides: {
            /** Mode */
            mode?: ("fast" | "standard") | null;
            /** Max Hypotheses */
            max_hypotheses?: number | null;
            /** Max Tool Calls */
            max_tool_calls?: number | null;
            /** Max Critic Cycles */
            max_critic_cycles?: number | null;
            /** Minimum Sample Size */
            minimum_sample_size?: number | null;
        };
        /** AnalysisReport */
        AnalysisReport: {
            /** Run Id */
            run_id: string;
            status: components["schemas"]["AnalysisStatus"];
            dataset_profile?: components["schemas"]["DatasetProfile"] | null;
            data_dictionary?: components["schemas"]["DataDictionary"] | null;
            /** Analysis Results */
            analysis_results?: components["schemas"]["AnalysisResult"][];
            /** Insights */
            insights?: components["schemas"]["Insight"][];
            metrics?: components["schemas"]["ExperimentMetrics"];
            /** Errors */
            errors?: string[];
            /** Warnings */
            warnings?: string[];
            /** Stage Statuses */
            stage_statuses?: {
                [key: string]: components["schemas"]["AnalysisStatus"];
            };
            /** Stage Durations */
            stage_durations?: {
                [key: string]: number;
            };
            /** Evidence */
            evidence?: components["schemas"]["Evidence"][];
            /** Relationship Assessments */
            relationship_assessments?: components["schemas"]["RelationshipAssessment"][];
            /** Configuration */
            configuration?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Execution Trace */
            execution_trace?: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
        };
        /** AnalysisResult */
        AnalysisResult: {
            /** Analysis Id */
            analysis_id?: string;
            /** Method */
            method: string;
            /** Variables */
            variables?: string[];
            status: components["schemas"]["AnalysisStatus"];
            result?: components["schemas"]["JsonValue"];
            /** P Value */
            p_value?: number | null;
            /** Effect Size */
            effect_size?: number | null;
            /** Sample Size */
            sample_size?: number | null;
            /** Warnings */
            warnings?: string[];
            /**
             * Execution Time
             * @default 0
             */
            execution_time: number;
            /** Metadata */
            metadata?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        /**
         * AnalysisStatus
         * @enum {string}
         */
        AnalysisStatus: "SUCCESS" | "FAILED" | "SKIPPED";
        /** Body_analysis_upload_analysis_upload_post */
        Body_analysis_upload_analysis_upload_post: {
            /** File */
            file: string;
            /**
             * Delimiter
             * @default ,
             */
            delimiter: string;
            /**
             * Encoding
             * @default utf-8
             */
            encoding: string;
            /** Data Dictionary */
            data_dictionary?: string | null;
            /** User Question */
            user_question?: string | null;
        };
        /** Body_intake_intake_post */
        Body_intake_intake_post: {
            /** File */
            file: string;
            /**
             * Delimiter
             * @default ,
             */
            delimiter: string;
            /**
             * Encoding
             * @default utf-8
             */
            encoding: string;
            /** Data Dictionary */
            data_dictionary?: string | null;
        };
        /** ColumnProfile */
        ColumnProfile: {
            /** Column Name */
            column_name: string;
            /** Data Type */
            data_type: string;
            semantic_type?: components["schemas"]["SemanticType"] | null;
            /** Missing Count */
            missing_count?: number | null;
            /** Unique Count */
            unique_count?: number | null;
            classification_source?: components["schemas"]["DictionarySource"] | null;
            /** Classification Reason */
            classification_reason?: string | null;
            /** Warnings */
            warnings?: string[];
        };
        /** ColumnSchema */
        ColumnSchema: {
            /** Name */
            name: string;
            /** Data Type */
            data_type: string;
            /**
             * Nullable
             * @default true
             */
            nullable: boolean;
        };
        /** CsvSourceSpec */
        CsvSourceSpec: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "csv";
            /**
             * Path
             * Format: path
             */
            path: string;
            /**
             * Delimiter
             * @default ,
             */
            delimiter: string;
            /**
             * Encoding
             * @default utf-8
             */
            encoding: string;
        };
        /** DataDictionary */
        DataDictionary: {
            /** Entries */
            entries?: components["schemas"]["DataDictionaryEntry"][];
        };
        /** DataDictionaryEntry */
        DataDictionaryEntry: {
            /** Column Name */
            column_name: string;
            /** Description */
            description?: string | null;
            /** Data Type */
            data_type?: string | null;
            /** Semantic Type */
            semantic_type?: string | null;
            /** Unit */
            unit?: string | null;
            source: components["schemas"]["DictionarySource"];
            /** Confidence */
            confidence?: number | null;
            /** Inferred Fields */
            inferred_fields?: ("description" | "data_type" | "semantic_type")[];
            /** Inference Reason */
            inference_reason?: string | null;
        };
        /** DatasetCompleteness */
        DatasetCompleteness: {
            /** Missing Cells */
            missing_cells: number;
            /** Total Cells */
            total_cells: number;
            /** Missing Percentage */
            missing_percentage: number;
            /** Column Missing Percentages */
            column_missing_percentages: {
                [key: string]: number;
            };
        };
        /** DatasetProfile */
        DatasetProfile: {
            /** Dataset Id */
            dataset_id: string;
            /** Row Count */
            row_count: number;
            /** Columns */
            columns?: components["schemas"]["ColumnProfile"][];
        };
        /** DatasetSchema */
        DatasetSchema: {
            /** Columns */
            columns?: components["schemas"]["ColumnSchema"][];
        };
        /** DatasetSummary */
        DatasetSummary: {
            /** Rows */
            rows: number;
            /** Columns */
            columns: number;
            /** Numeric Columns */
            numeric_columns: string[];
            /** Categorical Columns */
            categorical_columns: string[];
            /** Temporal Columns */
            temporal_columns: string[];
            /** Identifiers */
            identifiers: string[];
            /** Text Columns */
            text_columns: string[];
            /** Unknown Columns */
            unknown_columns: string[];
            data_dictionary: components["schemas"]["DataDictionary"];
        };
        /**
         * DictionarySource
         * @enum {string}
         */
        DictionarySource: "official" | "manual" | "schema" | "inferred";
        /** Evidence */
        Evidence: {
            /** Evidence Id */
            evidence_id: string;
            /** Analysis Id */
            analysis_id: string;
            /** Description */
            description: string;
            /** Limitations */
            limitations?: string[];
        };
        /** ExperimentMetrics */
        ExperimentMetrics: {
            /** Precision */
            precision?: number | null;
            /** Recall */
            recall?: number | null;
            /** F1 Score */
            f1_score?: number | null;
            /** False Positive Rate */
            false_positive_rate?: number | null;
            /** Pattern Detection Rate */
            pattern_detection_rate?: number | null;
            /** Spurious Detection Rate */
            spurious_detection_rate?: number | null;
            /** Hypothesis Consistency */
            hypothesis_consistency?: number | null;
            /** Insight Consistency */
            insight_consistency?: number | null;
            /** Tool Selection Consistency */
            tool_selection_consistency?: number | null;
            /** Conclusion Agreement */
            conclusion_agreement?: number | null;
            /** Semantic Similarity */
            semantic_similarity?: number | null;
            /** Total Response Time */
            total_response_time?: number | null;
            /** Time To First Insight */
            time_to_first_insight?: number | null;
            /** Llm Calls */
            llm_calls?: number | null;
            /** Tool Calls */
            tool_calls?: number | null;
            /** Tokens Used */
            tokens_used?: number | null;
            /** Iterations */
            iterations?: number | null;
            /** Profiling Time */
            profiling_time?: number | null;
            /** Analytics Time */
            analytics_time?: number | null;
            /** Completion Rate */
            completion_rate?: number | null;
            /** Human Intervention Rate */
            human_intervention_rate?: number | null;
            /** Valid Tool Selection Rate */
            valid_tool_selection_rate?: number | null;
            /** Invalid Analysis Rate */
            invalid_analysis_rate?: number | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HealthResponse */
        HealthResponse: {
            /**
             * Status
             * @default ok
             * @constant
             */
            status: "ok";
        };
        /** Insight */
        Insight: {
            /** Insight Id */
            insight_id: string;
            /** Statement */
            statement: string;
            /** Evidence Ids */
            evidence_ids?: string[];
            /** Limitations */
            limitations?: string[];
        };
        /**
         * IntakeResponse
         * @description Metadata-only HTTP response; no raw rows or server filesystem paths.
         */
        IntakeResponse: {
            /**
             * Status
             * @default SUCCESS
             * @constant
             */
            status: "SUCCESS";
            /** Filename */
            filename: string;
            profile: components["schemas"]["DatasetProfile"];
            summary: components["schemas"]["DatasetSummary"];
            completeness: components["schemas"]["DatasetCompleteness"];
            /** Warnings */
            warnings?: string[];
            /** Profiling Time */
            profiling_time: number;
        };
        /** JsonSourceSpec */
        JsonSourceSpec: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "json" | "jsonl";
            /**
             * Path
             * Format: path
             */
            path: string;
            /**
             * Encoding
             * @default utf-8
             */
            encoding: string;
        };
        JsonValue: unknown;
        /** PerformanceOverrides */
        PerformanceOverrides: {
            /** Timeout Seconds */
            timeout_seconds?: number | null;
            /** Parallel Tools */
            parallel_tools?: boolean | null;
        };
        /** RelationshipAssessment */
        RelationshipAssessment: {
            /** Variables */
            variables: string[];
            /** Evidence Ids */
            evidence_ids?: string[];
            /** Potentially Spurious */
            potentially_spurious?: boolean | null;
            /** Rationale */
            rationale?: string | null;
            /** Limitations */
            limitations?: string[];
        };
        /**
         * SemanticType
         * @enum {string}
         */
        SemanticType: "numeric" | "categorical" | "temporal" | "identifier" | "text" | "unknown";
        /** SqlSourceSpec */
        SqlSourceSpec: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "sql";
            /** Connection Ref */
            connection_ref: string;
            /** Table */
            table: string;
        };
        /** TextSourceSpec */
        TextSourceSpec: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "txt";
            /**
             * Path
             * Format: path
             */
            path: string;
            /** Delimiter */
            delimiter: string;
            /**
             * Encoding
             * @default utf-8
             */
            encoding: string;
        };
        /** ToolCatalog */
        ToolCatalog: {
            /** Tools */
            tools: string[];
        };
        /**
         * ToolRunRequest
         * @description HTTP body for running one deterministic tool on an intake dataset.
         */
        ToolRunRequest: {
            /** Variables */
            variables?: string[];
            /** Parameters */
            parameters?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        /** TsvSourceSpec */
        TsvSourceSpec: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "tsv";
            /**
             * Path
             * Format: path
             */
            path: string;
            /**
             * Encoding
             * @default utf-8
             */
            encoding: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    analysis_analysis_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnalysisInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalysisReport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    analysis_upload_analysis_upload_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_analysis_upload_analysis_upload_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalysisReport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    report_reports__run_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalysisReport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    report_metrics_reports__run_id__metrics_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExperimentMetrics"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    report_markdown_reports__run_id__markdown_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    intake_intake_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_intake_intake_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntakeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    tools_tools_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolCatalog"];
                };
            };
        };
    };
    run_tool_datasets__dataset_id__tools__tool_name__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                dataset_id: string;
                tool_name: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ToolRunRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalysisResult"];
                };
            };
            /** @description Dataset not in memory or unknown tool */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
