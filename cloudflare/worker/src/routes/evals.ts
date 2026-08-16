import type { Hono } from 'hono';
import { type KbQueryBody, MAX_EVAL_CASES, type ParseEvalBody, type QueryBody, type QueryEvalBody, type SearchEvalBody } from '../app-types';
import { average, elapsedMs, summarizeEvalReports, writeEvalReportAnalytics } from '../app-utils';
import type { Variables } from '../auth';
import { summarizeLatencies } from '../bench-utils';
import { parseUploadBytesWithCloudflare } from '../document-parser';
import {
  answerSupportQuality,
  contextWithIndex,
  DEFAULT_EVAL_JUDGE_MODEL,
  evalMatch,
  expectedTextList,
  judgeAnswerWithAi,
  parseEvalCaseBytes,
  parseEvalMatch,
  queryEvalHit,
  visionOcrModelChain,
} from '../query';
import type { AppRuntime } from '../runtime';
import type { Env, JsonRecord } from '../types';

type App = Hono<{ Bindings: Env; Variables: Variables }>;

export function registerEvalRoutes(app: App, rt: AppRuntime): void {
  const { makeMetadataRepository, runTextQuery, runKbAnswer } = rt;

  app.post('/v1/kb/evals/search', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as SearchEvalBody;
    const indexId = body.index_id?.trim();
    if (!indexId) return c.json({ error: 'index_id is required' }, 400);
    const cases = (Array.isArray(body.cases) ? body.cases : []).filter((testCase) => testCase.query?.trim()).slice(0, MAX_EVAL_CASES);
    if (cases.length === 0) return c.json({ error: 'cases array is required' }, 400);
    const queryBody: QueryBody = {};
    if (body.top_k !== undefined) queryBody.top_k = body.top_k;
    if (body.mode !== undefined) queryBody.mode = body.mode;
    if (body.semantic_model !== undefined) queryBody.semantic_model = body.semantic_model;
    if (body.rerank !== undefined) queryBody.rerank = body.rerank;
    if (body.rerank_model !== undefined) queryBody.rerank_model = body.rerank_model;
    if (body.mmr !== undefined) queryBody.mmr = body.mmr;
    if (body.query_rewrite !== undefined) queryBody.query_rewrite = body.query_rewrite;
    if (body.query_decompose !== undefined) queryBody.query_decompose = body.query_decompose;
    const rows = [];
    const latencies = [];
    let hits = 0;
    let reciprocalRankTotal = 0;
    for (const [i, testCase] of cases.entries()) {
      const started = performance.now();
      const result = await runTextQuery(contextWithIndex(c, indexId), testCase.query ?? '', queryBody);
      const elapsed = elapsedMs(started);
      latencies.push(elapsed);
      const rank = result.payload.data.findIndex((item) => evalMatch(item, testCase));
      const hit = rank >= 0;
      if (hit) {
        hits += 1;
        reciprocalRankTotal += 1 / (rank + 1);
      }
      rows.push({
        id: testCase.id ?? `case-${i + 1}`,
        query: testCase.query,
        hit,
        rank: hit ? rank + 1 : null,
        result_count: result.payload.data.length,
        top_score: result.payload.data[0]?.score ?? null,
        latency_ms: elapsed,
        cache: result.cache,
      });
    }
    const summary: JsonRecord = {
      project: c.get('tenant'),
      index_id: indexId,
      n: cases.length,
      hit_rate: hits / cases.length,
      mrr: reciprocalRankTotal / cases.length,
      latency: summarizeLatencies(latencies),
    };
    const metadataRepo = makeMetadataRepository(c.env);
    const report = await metadataRepo.insertEvalReport({
      project: c.get('tenant'),
      kind: 'search',
      indexId,
      summary,
      rows,
    });
    writeEvalReportAnalytics(c.env, report);
    return c.json({
      ...summary,
      report_id: report.id,
      rows,
    });
  });

  app.post('/v1/kb/evals/parse', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as ParseEvalBody;
    const domain = body.domain?.trim() || null;
    const cases = (Array.isArray(body.cases) ? body.cases : [])
      .filter((testCase) => (testCase.content_base64?.trim() || testCase.content !== undefined) && testCase.filename?.trim())
      .slice(0, MAX_EVAL_CASES);
    if (cases.length === 0) return c.json({ error: 'cases array is required' }, 400);
    const rows = [];
    const latencies = [];
    let passed = 0;
    const parserCounts: Record<string, number> = {};
    for (const [i, testCase] of cases.entries()) {
      const started = performance.now();
      const filename = testCase.filename?.trim() || `case-${i + 1}.txt`;
      const mime = testCase.mime?.trim() || null;
      const bytes = parseEvalCaseBytes(testCase);
      const markdownMode = testCase.markdown_conversion ?? body.markdown_conversion ?? c.env.RAG_MARKDOWN_CONVERSION ?? 'auto';
      const expected = expectedTextList(testCase.expected_text);
      const requestedVisionModel = testCase.vision_ocr_model ?? body.vision_ocr_model ?? c.env.RAG_VISION_OCR_MODEL ?? '';
      const visionModels = visionOcrModelChain(requestedVisionModel);
      const firstVisionModel = visionModels.length > 1 ? (visionModels[0] ?? '') : requestedVisionModel;
      let parsed = await parseUploadBytesWithCloudflare(filename, mime, bytes, c.env.AI, markdownMode, firstVisionModel);
      let textMatch = parseEvalMatch(parsed.text, expected);
      let parserMatched = testCase.expected_parser ? parsed.parser === testCase.expected_parser : true;
      let lengthMatched = testCase.min_text_length === undefined || parsed.text.length >= testCase.min_text_length;
      let ok = textMatch.missing.length === 0 && parserMatched && lengthMatched && parsed.text.length > 0;
      const triedVisionModels = firstVisionModel ? [firstVisionModel] : [];
      let retryReason: string | null = null;
      if (!ok && textMatch.missing.length > 0 && visionModels.length > 1) {
        const retryVisionModel = visionModels.slice(1).join(',');
        triedVisionModels.push(...visionModels.slice(1));
        retryReason = 'missing_expected_text';
        const retryParsed = await parseUploadBytesWithCloudflare(filename, mime, bytes, c.env.AI, markdownMode, retryVisionModel);
        const retryTextMatch = parseEvalMatch(retryParsed.text, expected);
        const retryParserMatched = testCase.expected_parser ? retryParsed.parser === testCase.expected_parser : true;
        const retryLengthMatched = testCase.min_text_length === undefined || retryParsed.text.length >= testCase.min_text_length;
        const retryOk = retryTextMatch.missing.length === 0 && retryParserMatched && retryLengthMatched && retryParsed.text.length > 0;
        const retryImproved =
          retryTextMatch.matched.length > textMatch.matched.length ||
          retryTextMatch.missing.length < textMatch.missing.length ||
          (retryTextMatch.matched.length === textMatch.matched.length && retryParsed.text.length > parsed.text.length);
        if (retryOk || retryImproved) {
          parsed = {
            ...retryParsed,
            warnings: [...(parsed.warnings ?? []).map((warning) => `vision_eval_first_attempt:${warning}`), ...(retryParsed.warnings ?? [])],
          };
          textMatch = retryTextMatch;
          parserMatched = retryParserMatched;
          lengthMatched = retryLengthMatched;
          ok = retryOk;
        }
      }
      const elapsed = elapsedMs(started);
      latencies.push(elapsed);
      parserCounts[parsed.parser] = (parserCounts[parsed.parser] ?? 0) + 1;
      if (ok) passed += 1;
      rows.push({
        id: testCase.id ?? `case-${i + 1}`,
        filename,
        mime,
        parser: parsed.parser,
        parser_version: parsed.parser_version,
        ok,
        expected_text_count: expected.length,
        matched_text_count: textMatch.matched.length,
        missing_text: textMatch.missing,
        parser_matched: parserMatched,
        expected_parser: testCase.expected_parser ?? null,
        length_matched: lengthMatched,
        min_text_length: testCase.min_text_length ?? null,
        text_length: parsed.text.length,
        document_count: parsed.documents.length,
        record_count: parsed.record_count,
        page_count: parsed.page_count,
        latency_ms: elapsed,
        warnings: parsed.warnings ?? [],
        vision_ocr_models_tried: triedVisionModels,
        vision_ocr_retry_reason: retryReason,
        ...(body.include_text_preview ? { text_preview: parsed.text.slice(0, 1200) } : {}),
      });
    }
    const summary: JsonRecord = {
      project: c.get('tenant'),
      domain,
      n: cases.length,
      pass_rate: passed / cases.length,
      parser_counts: parserCounts,
      latency: summarizeLatencies(latencies),
    };
    const metadataRepo = makeMetadataRepository(c.env);
    const report = await metadataRepo.insertEvalReport({
      project: c.get('tenant'),
      kind: 'parse',
      domain,
      summary,
      rows,
    });
    writeEvalReportAnalytics(c.env, report);
    return c.json({
      ...summary,
      report_id: report.id,
      rows,
    });
  });

  app.post('/v1/kb/evals/query', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as QueryEvalBody;
    const domain = body.domain?.trim();
    if (!domain) return c.json({ error: 'domain is required' }, 400);
    const cases = (Array.isArray(body.cases) ? body.cases : []).filter((testCase) => (testCase.question ?? testCase.query)?.trim()).slice(0, MAX_EVAL_CASES);
    if (cases.length === 0) return c.json({ error: 'cases array is required' }, 400);
    const rows = [];
    const latencies = [];
    let hits = 0;
    let cited = 0;
    let aiUsed = 0;
    let supportedAnswers = 0;
    let unsupportedTokenTotal = 0;
    const faithfulnessScores: number[] = [];
    const modelJudgeScores: number[] = [];
    let modelJudged = 0;
    let modelJudgeSupported = 0;
    const judgeModel = body.judge_model?.trim() || DEFAULT_EVAL_JUDGE_MODEL;
    for (const [i, testCase] of cases.entries()) {
      const started = performance.now();
      const question = (testCase.question ?? testCase.query ?? '').trim();
      const queryBody: KbQueryBody = {
        domain,
        question,
      };
      const sessionPrefix = body.session_id_prefix?.trim();
      if (sessionPrefix) queryBody.session_id = `${sessionPrefix}:${i + 1}`;
      if (body.top_k !== undefined) queryBody.top_k = body.top_k;
      if (body.mode !== undefined) queryBody.mode = body.mode;
      if (body.semantic_model !== undefined) queryBody.semantic_model = body.semantic_model;
      if (body.rerank !== undefined) queryBody.rerank = body.rerank;
      if (body.rerank_model !== undefined) queryBody.rerank_model = body.rerank_model;
      if (body.answer_mode !== undefined) queryBody.answer_mode = body.answer_mode;
      if (body.answer_model !== undefined) queryBody.answer_model = body.answer_model;
      if (body.mmr !== undefined) queryBody.mmr = body.mmr;
      if (body.query_rewrite !== undefined) queryBody.query_rewrite = body.query_rewrite;
      if (body.query_decompose !== undefined) queryBody.query_decompose = body.query_decompose;
      const result = await runKbAnswer(c, queryBody, started);
      const elapsed = elapsedMs(started);
      latencies.push(elapsed);
      const expectedText = (testCase.expected_answer_text ?? testCase.expected_citation_text ?? testCase.expected_text ?? '').trim().toLowerCase();
      const hit = queryEvalHit(result.payload, testCase);
      const hasCitation = result.payload.citations.length > 0 && /\[\d+\]/.test(result.payload.answer);
      const quality = answerSupportQuality(result.payload.answer, result.payload.citations, result.payload.data);
      let modelJudge: JsonRecord = {};
      if (body.ai_judge === true) {
        try {
          modelJudge = await judgeAnswerWithAi({
            env: c.env,
            question,
            expectedText,
            answer: result.payload.answer,
            citations: result.payload.citations,
            retrieved: result.payload.data,
            model: judgeModel,
          });
          modelJudged += 1;
          if (modelJudge.model_judge_status === 'supported') modelJudgeSupported += 1;
          if (typeof modelJudge.model_judge_score === 'number') modelJudgeScores.push(modelJudge.model_judge_score);
        } catch (error) {
          modelJudge = {
            model_judged: false,
            model_judge_model: judgeModel,
            model_judge_error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      const faithfulnessScore = typeof quality.citation_coverage === 'number' ? quality.citation_coverage : null;
      if (hit) hits += 1;
      if (hasCitation) cited += 1;
      if (result.payload.ai_used) aiUsed += 1;
      if (quality.status === 'supported') supportedAnswers += 1;
      unsupportedTokenTotal += typeof quality.unsupported_answer_token_count === 'number' ? quality.unsupported_answer_token_count : 0;
      if (faithfulnessScore !== null) faithfulnessScores.push(faithfulnessScore);
      rows.push({
        id: testCase.id ?? `case-${i + 1}`,
        question,
        hit,
        cited: hasCitation,
        faithfulness_status: quality.status,
        faithfulness_score: faithfulnessScore,
        answer_token_count: quality.answer_token_count,
        supported_answer_token_count: quality.supported_answer_token_count,
        unsupported_answer_token_count: quality.unsupported_answer_token_count,
        unsupported_answer_tokens: quality.unsupported_answer_tokens,
        route: result.payload.route,
        ai_used: result.payload.ai_used,
        result_count: result.payload.data.length,
        citation_count: result.payload.citations.length,
        latency_ms: elapsed,
        trace_id: result.payload.trace_id,
        ...modelJudge,
      });
    }
    const summary: JsonRecord = {
      project: c.get('tenant'),
      domain,
      n: cases.length,
      hit_rate: hits / cases.length,
      citation_rate: cited / cases.length,
      faithfulness_rate: supportedAnswers / cases.length,
      avg_faithfulness_score: average(faithfulnessScores),
      avg_unsupported_answer_tokens: unsupportedTokenTotal / cases.length,
      ai_use_rate: aiUsed / cases.length,
      model_judge_enabled: body.ai_judge === true,
      ...(body.ai_judge === true
        ? {
            model_judge_model: judgeModel,
            model_judged_count: modelJudged,
            model_judge_support_rate: modelJudged > 0 ? modelJudgeSupported / modelJudged : 0,
            avg_model_judge_score: average(modelJudgeScores),
          }
        : {}),
      latency: summarizeLatencies(latencies),
    };
    const metadataRepo = makeMetadataRepository(c.env);
    const report = await metadataRepo.insertEvalReport({
      project: c.get('tenant'),
      kind: 'query',
      domain,
      summary,
      rows,
    });
    writeEvalReportAnalytics(c.env, report);
    return c.json({
      ...summary,
      report_id: report.id,
      rows,
    });
  });

  app.get('/v1/kb/evals/reports', async (c) => {
    const metadataRepo = makeMetadataRepository(c.env);
    const kind = c.req.query('kind')?.trim() || undefined;
    const domain = c.req.query('domain')?.trim() || undefined;
    const limit = Number(c.req.query('limit') ?? 50);
    const reports = await metadataRepo.listEvalReports(c.get('tenant'), kind, domain, limit);
    return c.json({ project: c.get('tenant'), kind: kind ?? null, domain: domain ?? null, reports });
  });

  app.get('/v1/kb/evals/summary', async (c) => {
    const metadataRepo = makeMetadataRepository(c.env);
    const kind = c.req.query('kind')?.trim() || undefined;
    const domain = c.req.query('domain')?.trim() || undefined;
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 500), 1), 500);
    const reports = await metadataRepo.listEvalReports(c.get('tenant'), kind, domain, limit);
    return c.json({
      project: c.get('tenant'),
      kind: kind ?? null,
      domain: domain ?? null,
      report_count: reports.length,
      summaries: summarizeEvalReports(reports),
    });
  });

  app.get('/v1/kb/evals/reports/:id', async (c) => {
    const metadataRepo = makeMetadataRepository(c.env);
    const report = await metadataRepo.getEvalReport(c.get('tenant'), c.req.param('id'));
    if (!report) return c.json({ error: 'eval report not found' }, 404);
    return c.json(report);
  });
}
