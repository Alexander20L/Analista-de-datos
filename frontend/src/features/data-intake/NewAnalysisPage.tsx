import { ArrowRight, CheckCircle2, Database, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { useIntake } from "./IntakeProvider";
import { DatasetUpload } from "./DatasetUpload";
import { DataDictionaryUpload } from "./DataDictionaryUpload";

export function NewAnalysisPage() {
  const { draft, updateDraft, loading, error, analyze } = useIntake();
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await analyze()) navigate("/dataset");
  }
  return <div className="new-analysis-page">
    <div className="page-heading"><p className="eyebrow">New analysis</p>
      <h1>Analyze your data</h1>
      <p>Start with a dataset. Understand its structure before exploring relationships and insights.</p>
    </div>
    <Card className="intake-card"><form onSubmit={submit}>
      <DatasetUpload file={draft.file} disabled={loading} onChange={(file) => updateDraft({ file })} />
      <div className="upload-caption"><span><Database size={13} />Connect to SQL <Badge>Coming Soon</Badge></span>
        <span>Your dataset is processed locally by Python.</span></div>
      <div className="reading-options">
        <div className="field"><label htmlFor="delimiter">CSV / TXT separator</label>
          <select id="delimiter" value={draft.delimiter} disabled={loading || /\.(tsv|json|jsonl)$/i.test(draft.file?.name || "")}
            onChange={(event) => updateDraft({ delimiter: event.target.value })}>
            <option value=",">Comma (,)</option><option value=";">Semicolon (;)</option>
            <option value={"\t"}>Tab</option><option value="|">Pipe (|)</option>
          </select>
        </div>
        <div className="field"><label htmlFor="encoding">File encoding</label>
          <select id="encoding" value={draft.encoding} disabled={loading} onChange={(event) => updateDraft({ encoding: event.target.value })}>
            <option value="utf-8">UTF-8</option><option value="utf-8-sig">UTF-8 with BOM</option>
            <option value="cp1252">Windows-1252</option><option value="latin-1">Latin-1</option>
          </select>
        </div>
      </div>
      <DataDictionaryUpload file={draft.dictionary} disabled={loading} onChange={(dictionary) => updateDraft({ dictionary })} />
      <div className="field planned-question"><label htmlFor="question">What would you like to investigate? <Badge>Coming Soon</Badge></label>
        <textarea id="question" disabled placeholder="Research questions will be available with the analysis planner." rows={2} />
      </div>
      <fieldset className="mode-fieldset"><legend>Analysis mode</legend><div className="mode-options">
        <div className="mode-card selected"><div><span className="eyebrow">Intake</span><CheckCircle2 size={16} /></div>
          <strong>Understand your dataset</strong><p>Validate the file, classify columns and build a data dictionary.</p></div>
        <div className="mode-card unavailable-mode"><div><span className="eyebrow">Fast / Deep</span><Badge>Coming Soon</Badge></div>
          <strong>Explore the evidence</strong><p>Statistical tools, controls and multiagent analysis come next.</p></div>
      </div></fieldset>
      {error && <div className="error-panel" role="alert"><TriangleAlert size={19} /><div>
        <strong>The dataset could not be processed</strong><p>{error.message}</p>
        <p>Check the file format, separator and dictionary, then try again. Your settings are preserved.</p>
        {error.requestId && <small>Request ID: <code>{error.requestId}</code></small>}
      </div></div>}
      {loading && <div className="processing-panel" role="status" aria-live="polite">
        <LoaderCircle size={18} className="spin" /><div><strong>Understanding your dataset</strong>
          <p>Reading and validating the file, profiling columns and preparing the dictionary.</p></div>
      </div>}
      <div className="form-footer"><p>{draft.file ? "Ready to review your data. No statistical analysis will run." : "Select a dataset to begin. No analysis has run yet."}</p>
        <Button type="submit" disabled={!draft.file || loading}>
          {loading ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}
          {loading ? "Processing…" : "Understand Dataset"}
        </Button>
      </div>
    </form></Card>
    <div className="info-note"><Info size={16} /><div><strong>A workspace for analysis, not a chat window</strong>
      <p>Start with data. Review the detected schema and its provenance. Relationships, insights and follow-up questions are planned for a later release.</p>
    </div></div>
  </div>;
}
