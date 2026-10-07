(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XstPhoneHostPanel = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const FIELDS = ["schema_version", "project_key", "environment", "runtime_project",
    "source_commit", "core_source_commit", "core_ready", "asr_ready", "tts_ready",
    "outbox_ready", "observed_at", "state", "errors"];
  const ERRORS = Object.freeze({
    SOURCE_IDENTITY_UNVERIFIED:"启动入口版本尚未核实",
    RUNTIME_EVIDENCE_INVALID:"运行环境记录未通过校验",
    PROTECTED_RUNTIME_MATCH:"命中受保护运行环境，已停止操作",
    DOCKER_UNAVAILABLE:"Docker 尚未就绪",
    DOCKER_TIMEOUT:"Docker 状态检查超时",
    CONTAINER_MISSING:"既有服务容器不存在",
    CONTAINER_IDENTITY_MISMATCH:"服务容器身份不一致",
    DATABASE_IDENTITY_MISMATCH:"数据库身份不一致",
    DATABASE_TARGET_UNVERIFIED:"数据库目标尚未核实",
    RUNTIME_BINDING_UNSAFE:"服务网络绑定未通过校验",
    RUNTIME_START_FAILED:"既有服务启动失败",
    CORE_NOT_READY:"Core 与数据库尚未就绪",
    OUTBOX_NOT_READY:"Worker 与数据库连接尚未就绪",
    ASR_NOT_READY:"语音识别尚未就绪",
    TTS_NOT_READY:"语音播放服务尚未就绪",
    SPEECH_AUTHORITY_UNVERIFIED:"语音模型来源尚未核实",
    SPEECH_START_FAILED:"语音服务启动失败",
    STATUS_CHECK_FAILED:"状态检查未完成"
  });
  const MAX_AGE = 5 * 60 * 1000;
  const invalid = () => ({kind:"invalid"});
  function parseReceipt(value, now = Date.now()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const keys = Object.keys(value);
    if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key))) return invalid();
    if (value.schema_version !== 1 || value.project_key !== "xiaoshutong"
      || value.environment !== "5070ti" || value.runtime_project !== "goal64-phone-20261006") return invalid();
    if (typeof value.source_commit !== "string" || !/^[a-f0-9]{40}$/.test(value.source_commit)
      || (value.core_source_commit !== null && (typeof value.core_source_commit !== "string" || !/^[a-f0-9]{40}$/.test(value.core_source_commit)))) return invalid();
    const ready = ["core_ready","asr_ready","tts_ready","outbox_ready"];
    if (ready.some(key => typeof value[key] !== "boolean")) return invalid();
    if (!["READY","NOT_READY","FAILED"].includes(value.state)) return invalid();
    if (!Array.isArray(value.errors) || value.errors.length > 16
      || value.errors.some(code => typeof code !== "string" || !Object.hasOwn(ERRORS,code))) return invalid();
    if ((value.state === "READY") !== (ready.every(key => value[key]) && !value.errors.length)) return invalid();
    if (typeof value.observed_at !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value.observed_at)) return invalid();
    const observed = Date.parse(value.observed_at);
    if (!Number.isFinite(observed) || !Number.isFinite(now) || observed > now + 30000) return invalid();
    const report = Object.freeze({...value, errors:Object.freeze([...value.errors])});
    return {kind:"report", report, fresh:now - observed <= MAX_AGE};
  }
  function consumeReceipt(location, history, now = Date.now()) {
    const prefix = "#xst_host_receipt=";
    const hash = String(location.hash || "");
    if (!hash.startsWith(prefix)) return {kind:"empty"};
    history.replaceState(null, "", location.pathname + location.search);
    if (hash.length > 4096) return invalid();
    try { return parseReceipt(JSON.parse(decodeURIComponent(hash.slice(prefix.length))), now); }
    catch (_) { return invalid(); }
  }
  function createPanel({document, root, result = {kind:"empty"}, now = Date.now, schedule, cancel}) {
    let current = result, timer = null;
    function stopTimer() { if (timer !== null && cancel) cancel(timer); timer = null; }
    function element(tag, text, className) {
      const node = document.createElement(tag);
      node.textContent = text || "";
      if (className) node.className = className;
      return node;
    }
    function hide() { stopTimer(); root.replaceChildren(); root.hidden = true; }
    function show({projectKey, authorized}) {
      hide();
      if (projectKey !== "xiaoshutong" || authorized !== true) return;
      root.hidden = false;
      root.className = "card";
      root.append(element("h2", "5070TI 托管服务"));
      root.append(element("p", "启动入口与模型、语音配置共用此运维台。", "muted"));
      if (current.kind !== "report") {
        root.append(element("p", current.kind === "invalid"
          ? "启动报告未通过校验，请重新运行本机启动入口。"
          : "尚未收到启动报告。请在 5070TI 使用一键入口，再打开此运维台。", "status"));
      } else {
        const checked = parseReceipt(current.report, now());
        if (checked.kind !== "report") { current = invalid(); show({projectKey,authorized}); return; }
        const report = checked.report;
        const label = !checked.fresh ? "报告已过期，待重新检查"
          : report.state === "READY" ? "启动检查通过"
          : report.state === "NOT_READY" ? "部分服务尚未就绪" : "启动检查失败";
        root.append(element("p", label, "status " + (checked.fresh && report.state === "READY" ? "ok" : "bad")));
        root.append(element("p", "启动器检查时间：" + new Date(report.observed_at).toLocaleString(), "field-note"));
        const grid = element("div", "", "grid");
        for (const [key,title] of [["core_ready","Core / 数据库"],["asr_ready","语音识别"],
          ["tts_ready","语音播放"],["outbox_ready","Worker / 数据库"]]) {
          grid.append(element("p", title + "：" + (report[key] ? "检查通过" : "待就绪")));
        }
        root.append(grid);
        root.append(element("p", "启动入口版本：" + report.source_commit.slice(0,12)
          + " · Core 部署版本：" + (report.core_source_commit ? report.core_source_commit.slice(0,12) : "尚未核实"), "field-note"));
        root.append(element("p", "此结果是启动器在上述时间的观察，未经服务器签名验证，不是持续监测。服务变化后请重新检查。", "muted"));
        root.append(element("p", "Worker 检查只确认进程与数据库连接；事件消费尚未验收。", "field-note"));
        if (report.errors.length) {
          const list = element("ul");
          for (const code of report.errors) list.append(element("li", ERRORS[code]));
          root.append(list);
        }
        if (checked.fresh && schedule) {
          timer = schedule(() => show({projectKey,authorized}), Math.max(1000, MAX_AGE - (now() - Date.parse(report.observed_at)) + 1));
        }
      }
      const command = "pwsh -NoProfile -File tools/start_phone_host.ps1 -OpenOperations";
      root.append(element("p", "本机启动命令（在交付工作目录运行）", "field-note"));
      root.append(element("code", command));
      root.append(element("p", "只复用已核实的现有服务；缺失或身份不符时明确退出，不创建替代数据库。", "muted"));
    }
    function clear() { current = {kind:"empty"}; hide(); }
    hide();
    return Object.freeze({show, hide, clear});
  }
  return Object.freeze({parseReceipt, consumeReceipt, createPanel});
});
