import{createRequire as V}from"node:module";import{existsSync as Q,unlinkSync as k,renameSync as Z}from"node:fs";import{tmpdir as J}from"node:os";import{join as tt}from"node:path";var N=class{#t;constructor(t){this.#t=t}pragma(t){let n=this.#t.prepare(`PRAGMA ${t}`).all();if(!n||n.length===0)return;if(n.length>1)return n;let r=Object.values(n[0]);return r.length===1?r[0]:n[0]}exec(t){let e="",n=null;for(let o=0;o<t.length;o++){let a=t[o];if(n)e+=a,a===n&&(n=null);else if(a==="'"||a==='"')e+=a,n=a;else if(a===";"){let c=e.trim();c&&this.#t.prepare(c).run(),e=""}else e+=a}let r=e.trim();return r&&this.#t.prepare(r).run(),this}prepare(t){let e=this.#t.prepare(t);return{run:(...n)=>e.run(...n),get:(...n)=>{let r=e.get(...n);return r===null?void 0:r},all:(...n)=>e.all(...n),iterate:(...n)=>e.iterate(...n)}}transaction(t){return this.#t.transaction(t)}close(){this.#t.close()}},w=class{#t;constructor(t){this.#t=t}pragma(t){let n=this.#t.prepare(`PRAGMA ${t}`).all();if(!n||n.length===0)return;if(n.length>1)return n;let r=Object.values(n[0]);return r.length===1?r[0]:n[0]}exec(t){return this.#t.exec(t),this}prepare(t){let e=this.#t.prepare(t);return{run:(...n)=>e.run(...n),get:(...n)=>e.get(...n),all:(...n)=>e.all(...n),iterate:(...n)=>typeof e.iterate=="function"?e.iterate(...n):e.all(...n)[Symbol.iterator]()}}transaction(t){return(...e)=>{this.#t.exec("BEGIN");try{let n=t(...e);return this.#t.exec("COMMIT"),n}catch(n){throw this.#t.exec("ROLLBACK"),n}}}close(){this.#t.close()}},p=null;function et(s){let t=null;try{return t=new s(":memory:"),t.exec("CREATE VIRTUAL TABLE __fts5_probe USING fts5(x)"),!0}catch{return!1}finally{try{t?.close()}catch{}}}function nt(s,t){let e=t!==void 0?t:globalThis.Bun;if(typeof e<"u"&&e!==null)return!0;let n=s??process.versions,[r,o]=(n.node??"0.0.0").split("."),a=Number(r),c=Number(o);return!Number.isFinite(a)||!Number.isFinite(c)?!1:a>22||a===22&&c>=5}function st(){if(!p){let s=V(import.meta.url);if(globalThis.Bun){let t=s(["bun","sqlite"].join(":")).Database;p=function(n,r){let o=new t(n,{readonly:r?.readonly,create:!0}),a=new N(o);return r?.timeout&&a.pragma(`busy_timeout = ${r.timeout}`),a}}else if(nt()){let t=null;try{({DatabaseSync:t}=s(["node","sqlite"].join(":")))}catch{t=null}t&&et(t)?p=function(n,r){let o=new t(n,{readOnly:r?.readonly??!1});return new w(o)}:p=s("better-sqlite3")}else p=s("better-sqlite3")}return p}function rt(s){s.pragma("journal_mode = WAL"),s.pragma("synchronous = NORMAL");try{s.pragma("mmap_size = 268435456")}catch{}}function U(s){if(!Q(s))for(let t of["-wal","-shm"])try{k(s+t)}catch{}}function it(s){for(let t of["","-wal","-shm"])try{k(s+t)}catch{}}function b(s){try{s.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{s.close()}catch{}}function B(s="context-mode"){return tt(J(),`${s}-${process.pid}.db`)}function ot(s){if(!(s<=0))try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,s)}catch{let t=Date.now();for(;Date.now()-t<s;);}}function P(s,t=[50,100,250,500,1e3,2e3,4e3]){let e;for(let n=0;n<=t.length;n++)try{return s()}catch(r){let o=r instanceof Error?r.message:String(r);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw r;e=r instanceof Error?r:new Error(o),n<t.length&&ot(t[n])}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${e?.message}`)}function M(s,t,e={}){return P(()=>{let n=new s(t,{timeout:e.busyTimeoutMs??3e4});try{return rt(n),n}catch(r){throw b(n),r}},e.retryDelays)}function at(s){return s.includes("SQLITE_CORRUPT")||s.includes("SQLITE_NOTADB")||s.includes("database disk image is malformed")||s.includes("file is not a database")}function ct(s){let t=Date.now();for(let e of["","-wal","-shm"])try{Z(s+e,`${s}${e}.corrupt-${t}`)}catch{}}var _=Symbol.for("__context_mode_live_dbs_v3__"),O=(()=>{let s=globalThis;return s[_]||(s[_]=new Set,process.on("exit",()=>{for(let t of s[_])b(t);s[_].clear()})),s[_]})(),T=class{#t;#e;#n;constructor(t,e={}){let n=st();this.#t=t,this.#n=e.retryDelays,U(t);let r;try{r=M(n,t,e)}catch(o){let a=o instanceof Error?o.message:String(o);if(at(a)){ct(t),U(t);try{r=M(n,t,e)}catch(c){throw new Error(`Failed to create fresh DB after renaming corrupt file: ${c instanceof Error?c.message:String(c)}`)}}else throw o}this.#e=r,O.add(this.#e),this.withRetry(()=>this.initSchema()),this.prepareStatements()}get db(){return this.#e}get dbPath(){return this.#t}close(){O.delete(this.#e),b(this.#e)}withRetry(t){return P(t,this.#n)}cleanup(){O.delete(this.#e),b(this.#e),it(this.#t)}};import{createHash as g}from"node:crypto";import{execFileSync as ut}from"node:child_process";import{existsSync as m,realpathSync as dt,renameSync as R}from"node:fs";import{join as L}from"node:path";function F(s){let t=s.replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API[_-]?KEY|AUTH|COOKIE|CREDENTIAL)[A-Z0-9_]*=)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,"$1<redacted>");return t=t.replace(/(https?:\/\/)([^:\s/@]+):([^@\s]+)@/gi,"$1<user>:<redacted>@"),t=t.replace(/(--(?:token|password|secret|api-key|auth|cookie)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi,"$1<redacted>"),t}var h;function y(s){let t=s.replace(/\\/g,"/");return/^\/+$/.test(t)?"/":/^[A-Za-z]:\/+$/.test(t)?`${t.slice(0,2)}/`:t.replace(/\/+$/,"")}function j(s){let t=s;try{t=dt.native(s)}catch{}let e=y(t);return process.platform==="win32"||process.platform==="darwin"?e.toLowerCase():e}function G(s,t){return ut("git",["-C",s,...t],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).trim()}var lt=new Set(["rawcommand","raw_command","rawoutput","raw_output","rawstdout","raw_stdout","rawstderr","raw_stderr","rawstdin","raw_stdin"]);function A(s,t){let e=s.toLowerCase();if(lt.has(e))return"<redacted:trace-forbidden-field>";if(e==="command"&&typeof t=="string")return F(t);if(Array.isArray(t))return t.map(n=>A("",n));if(t&&typeof t=="object"){let n={};for(let[r,o]of Object.entries(t))n[r]=A(r,o);return n}return t}function W(s){try{let t=JSON.parse(s);return!t||typeof t!="object"?s:JSON.stringify(A("",t))}catch{return s}}function Et(s){let t=G(s,["rev-parse","--show-toplevel"]);return t.length>0?y(t):null}function pt(s){let t=G(s,["worktree","list","--porcelain"]).split(/\r?\n/).find(e=>e.startsWith("worktree "))?.replace("worktree ","")?.trim();return t?y(t):null}function ht(s=process.cwd()){let t=process.env.CONTEXT_MODE_SESSION_SUFFIX;if(h&&h.projectDir===s&&h.envSuffix===t)return h.suffix;let e="";if(t!==void 0)e=t?`__${t}`:"";else try{let n=Et(s),r=pt(s);if(n&&r){let o=j(n),a=j(r);o!==a&&(e=`__${g("sha256").update(o).digest("hex").slice(0,8)}`)}}catch{}return h={projectDir:s,envSuffix:t,suffix:e},e}function Ot(){h=void 0}function Y(s){return g("sha256").update(y(s)).digest("hex").slice(0,16)}function z(s){let t=y(s),e=process.platform==="darwin"||process.platform==="win32"?t.toLowerCase():t;return g("sha256").update(e).digest("hex").slice(0,16)}function Nt(s){let{projectDir:t,contentDir:e}=s,n=z(t),r=L(e,`${n}.db`);if(m(r))return r;let o=Y(t);if(o===n)return r;let a=L(e,`${o}.db`);if(m(a))try{R(a,r);for(let c of["-wal","-shm"])try{R(a+c,r+c)}catch{}}catch{}return r}function wt(s){return mt({...s,ext:".db"})}function mt(s){let{projectDir:t,sessionsDir:e,ext:n}=s,r=s.suffix??ht(t),o=z(t),a=L(e,`${o}${r}${n}`);if(m(a))return a;let c=Y(t);if(c===o)return a;let d=L(e,`${c}${r}${n}`);if(m(d))try{R(d,a);for(let l of["-wal","-shm"]){let u=`${d}${l}`,E=`${a}${l}`;m(u)&&!m(E)&&R(u,E)}}catch{}return a}var H=1e3,X=5;function S(s){let t=Number(s);return!Number.isFinite(t)||t<=0?0:Math.floor(t)}var i={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",getLatestAttributedProject:"getLatestAttributedProject",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",updateMetaLastEvents:"updateMetaLastEvents",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",claimLatestUnconsumedResume:"claimLatestUnconsumedResume",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions",searchEvents:"searchEvents",incrementToolCall:"incrementToolCall",getToolCallTotals:"getToolCallTotals",getToolCallByTool:"getToolCallByTool",getEventBytesSummary:"getEventBytesSummary",listSessions:"listSessions",getEventsSince:"getEventsSince",getLatestEvents:"getLatestEvents"},$=class extends T{constructor(t){super(t?.dbPath??B("session"),t)}stmt(t){return this.stmts.get(t)}initSchema(){try{let e=this.db.pragma("table_xinfo(session_events)").find(n=>n.name==="data_hash");e&&e.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 2,
        data TEXT NOT NULL,
        project_dir TEXT NOT NULL DEFAULT '',
        attribution_source TEXT NOT NULL DEFAULT 'unknown',
        attribution_confidence REAL NOT NULL DEFAULT 0,
        bytes_avoided INTEGER NOT NULL DEFAULT 0,
        bytes_returned INTEGER NOT NULL DEFAULT 0,
        source_hook TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        data_hash TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(session_id, type);
      CREATE INDEX IF NOT EXISTS idx_session_events_priority ON session_events(session_id, priority);
      CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON session_events(created_at, id);

      CREATE TABLE IF NOT EXISTS session_meta (
        session_id TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_event_at TEXT,
        event_count INTEGER NOT NULL DEFAULT 0,
        compact_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_resume (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        snapshot TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        consumed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        session_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        calls INTEGER NOT NULL DEFAULT 0,
        bytes_returned INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, tool)
      );

      CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    `);try{let t=this.db.pragma("table_xinfo(session_events)"),e=new Set(t.map(n=>n.name));e.has("project_dir")||this.db.exec("ALTER TABLE session_events ADD COLUMN project_dir TEXT NOT NULL DEFAULT ''"),e.has("attribution_source")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'unknown'"),e.has("attribution_confidence")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_confidence REAL NOT NULL DEFAULT 0"),e.has("bytes_avoided")||this.db.exec("ALTER TABLE session_events ADD COLUMN bytes_avoided INTEGER NOT NULL DEFAULT 0"),e.has("bytes_returned")||this.db.exec("ALTER TABLE session_events ADD COLUMN bytes_returned INTEGER NOT NULL DEFAULT 0"),this.db.exec("CREATE INDEX IF NOT EXISTS idx_session_events_project ON session_events(session_id, project_dir)")}catch{}}prepareStatements(){this.stmts=new Map;let t=(e,n)=>{this.stmts.set(e,this.db.prepare(n))};t(i.insertEvent,`INSERT INTO session_events (
         session_id, type, category, priority, data,
         project_dir, attribution_source, attribution_confidence,
         bytes_avoided, bytes_returned,
         source_hook, data_hash
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),t(i.getEvents,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              bytes_avoided, bytes_returned,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ?`),t(i.getEventsByType,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              bytes_avoided, bytes_returned,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? ORDER BY id ASC LIMIT ?`),t(i.getEventsByPriority,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              bytes_avoided, bytes_returned,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(i.getEventsByTypeAndPriority,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              bytes_avoided, bytes_returned,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(i.getEventCount,"SELECT COUNT(*) AS cnt FROM session_events WHERE session_id = ?"),t(i.getLatestAttributedProject,`SELECT project_dir
       FROM session_events
       WHERE session_id = ? AND project_dir != ''
       ORDER BY id DESC
       LIMIT 1`),t(i.checkDuplicate,`SELECT 1 FROM (
         SELECT type, data_hash FROM session_events
         WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) AS recent
       WHERE recent.type = ? AND recent.data_hash = ?
       LIMIT 1`),t(i.evictLowestPriority,`DELETE FROM session_events WHERE id = (
         SELECT id FROM session_events WHERE session_id = ?
         ORDER BY priority ASC, id ASC LIMIT 1
       )`),t(i.updateMetaLastEvent,`UPDATE session_meta
       SET last_event_at = datetime('now'), event_count = event_count + 1
       WHERE session_id = ?`),t(i.updateMetaLastEvents,`UPDATE session_meta
       SET last_event_at = datetime('now'), event_count = event_count + ?
       WHERE session_id = ?`),t(i.ensureSession,"INSERT OR IGNORE INTO session_meta (session_id, project_dir) VALUES (?, ?)"),t(i.getSessionStats,`SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`),t(i.listSessions,`SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta ORDER BY started_at DESC, rowid DESC LIMIT ?`),t(i.incrementCompactCount,"UPDATE session_meta SET compact_count = compact_count + 1 WHERE session_id = ?"),t(i.upsertResume,`INSERT INTO session_resume (session_id, snapshot, event_count)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         snapshot = excluded.snapshot,
         event_count = excluded.event_count,
         created_at = datetime('now'),
         consumed = 0`),t(i.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),t(i.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),t(i.claimLatestUnconsumedResume,`UPDATE session_resume
       SET consumed = 1
       WHERE id = (
         SELECT id FROM session_resume
         WHERE consumed = 0
           AND session_id != ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
       RETURNING session_id, snapshot`),t(i.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),t(i.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),t(i.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),t(i.searchEvents,`SELECT id, session_id, category, type, data, created_at
       FROM session_events
       WHERE project_dir = ?
         AND (data LIKE '%' || ? || '%' ESCAPE '\\' OR category LIKE '%' || ? || '%' ESCAPE '\\')
         AND (? IS NULL OR category = ?)
       ORDER BY id ASC
       LIMIT ?`),t(i.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')"),t(i.incrementToolCall,`INSERT INTO tool_calls (session_id, tool, calls, bytes_returned)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(session_id, tool) DO UPDATE SET
         calls = calls + 1,
         bytes_returned = bytes_returned + excluded.bytes_returned,
         updated_at = datetime('now')`),t(i.getToolCallTotals,`SELECT COALESCE(SUM(calls), 0) AS calls,
              COALESCE(SUM(bytes_returned), 0) AS bytes_returned
       FROM tool_calls WHERE session_id = ?`),t(i.getToolCallByTool,`SELECT tool, calls, bytes_returned
       FROM tool_calls WHERE session_id = ? ORDER BY calls DESC`),t(i.getEventBytesSummary,`SELECT COALESCE(SUM(bytes_avoided), 0) AS bytes_avoided,
              COALESCE(SUM(bytes_returned), 0) AS bytes_returned
       FROM session_events WHERE session_id = ?`),t(i.getEventsSince,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              bytes_avoided, bytes_returned,
              source_hook, created_at, data_hash
       FROM session_events WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?`),t(i.getLatestEvents,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              bytes_avoided, bytes_returned,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id DESC LIMIT ?`)}insertEvent(t,e,n="PostToolUse",r,o){let a=W(e.data),c=g("sha256").update(a).digest("hex").slice(0,16).toUpperCase(),d=String(r?.projectDir??e.project_dir??"").trim(),l=String(r?.source??e.attribution_source??"unknown"),u=Number(r?.confidence??e.attribution_confidence??0),E=Number.isFinite(u)?Math.max(0,Math.min(1,u)):0,f=S(o?.bytesAvoided),v=S(o?.bytesReturned),C=this.db.transaction(()=>{if(this.stmt(i.checkDuplicate).get(t,X,e.type,c))return;this.stmt(i.getEventCount).get(t).cnt>=H&&this.stmt(i.evictLowestPriority).run(t),this.stmt(i.insertEvent).run(t,e.type,e.category,e.priority,a,d,l,E,f,v,n,c),this.stmt(i.updateMetaLastEvent).run(t)});this.withRetry(()=>C())}bulkInsertEvents(t,e,n="PostToolUse",r,o){if(!e||e.length===0)return;if(e.length===1){this.insertEvent(t,e[0],n,r?.[0],o?.[0]);return}let a=e.map((d,l)=>{let u=W(d.data),E=g("sha256").update(u).digest("hex").slice(0,16).toUpperCase(),f=r?.[l],v=String(f?.projectDir??d.project_dir??"").trim(),C=String(f?.source??d.attribution_source??"unknown"),D=Number(f?.confidence??d.attribution_confidence??0),I=Number.isFinite(D)?Math.max(0,Math.min(1,D)):0,x=o?.[l],q=S(x?.bytesAvoided),K=S(x?.bytesReturned);return{event:d,eventData:u,dataHash:E,projectDir:v,attributionSource:C,attributionConfidence:I,bytesAvoided:q,bytesReturned:K}}),c=this.db.transaction(()=>{let d=this.stmt(i.getEventCount).get(t).cnt,l=0;for(let u of a)this.stmt(i.checkDuplicate).get(t,X,u.event.type,u.dataHash)||(d>=H?this.stmt(i.evictLowestPriority).run(t):d++,this.stmt(i.insertEvent).run(t,u.event.type,u.event.category,u.event.priority,u.eventData,u.projectDir,u.attributionSource,u.attributionConfidence,u.bytesAvoided,u.bytesReturned,n,u.dataHash),l++);l>0&&this.stmt(i.updateMetaLastEvents).run(l,t)});this.withRetry(()=>c())}getEvents(t,e){let n=e?.limit??1e3,r=e?.type,o=e?.minPriority;return r&&o!==void 0?this.stmt(i.getEventsByTypeAndPriority).all(t,r,o,n):r?this.stmt(i.getEventsByType).all(t,r,n):o!==void 0?this.stmt(i.getEventsByPriority).all(t,o,n):this.stmt(i.getEvents).all(t,n)}getEventCount(t){return this.stmt(i.getEventCount).get(t).cnt}getEventBytesSummary(t){let e=this.stmt(i.getEventBytesSummary).get(t);return{bytesAvoided:Number(e?.bytes_avoided??0),bytesReturned:Number(e?.bytes_returned??0)}}getLatestAttributedProjectDir(t){return this.stmt(i.getLatestAttributedProject).get(t)?.project_dir||null}searchEvents(t,e,n,r){try{let o=t.replace(/[%_]/g,c=>"\\"+c),a=r??null;return this.stmt(i.searchEvents).all(n,o,o,a,a,e)}catch{return[]}}ensureSession(t,e){this.withRetry(()=>this.stmt(i.ensureSession).run(t,e))}getSessionStats(t){return this.stmt(i.getSessionStats).get(t)??null}incrementCompactCount(t){this.withRetry(()=>this.stmt(i.incrementCompactCount).run(t))}upsertResume(t,e,n){this.withRetry(()=>this.stmt(i.upsertResume).run(t,e,n??0))}getResume(t){return this.stmt(i.getResume).get(t)??null}markResumeConsumed(t){this.withRetry(()=>this.stmt(i.markResumeConsumed).run(t))}claimLatestUnconsumedResume(t){let e=this.withRetry(()=>this.stmt(i.claimLatestUnconsumedResume).get(t));return e?{sessionId:e.session_id,snapshot:e.snapshot}:null}getLatestSessionId(){try{return this.db.prepare("SELECT session_id FROM session_meta ORDER BY started_at DESC, rowid DESC LIMIT 1").get()?.session_id??null}catch{return null}}listSessions(t=50){try{return this.stmt(i.listSessions).all(t)}catch{return[]}}getEventsSince(t,e=5e3){try{return this.stmt(i.getEventsSince).all(t,e)}catch{return[]}}getLatestEvents(t,e=1e3){try{return this.stmt(i.getLatestEvents).all(t,e).reverse()}catch{return[]}}incrementToolCall(t,e,n=0){let r=Number.isFinite(n)&&n>0?Math.round(n):0;try{this.withRetry(()=>this.stmt(i.incrementToolCall).run(t,e,r))}catch{}}getToolCallStats(t){try{let e=this.stmt(i.getToolCallTotals).get(t),n=this.stmt(i.getToolCallByTool).all(t),r={};for(let o of n)r[o.tool]={calls:o.calls,bytesReturned:o.bytes_returned};return{totalCalls:e?.calls??0,totalBytesReturned:e?.bytes_returned??0,byTool:r}}catch{return{totalCalls:0,totalBytesReturned:0,byTool:{}}}}deleteSession(t){let e=this.db.transaction(()=>{this.stmt(i.deleteEvents).run(t),this.stmt(i.deleteResume).run(t),this.stmt(i.deleteMeta).run(t)});this.withRetry(()=>e())}cleanupOldSessions(t=7){let e=`-${t}`,n=this.stmt(i.getOldSessions).all(e);for(let{session_id:r}of n)this.deleteSession(r);return n.length}};export{$ as SessionDB,Ot as _resetWorktreeSuffixCacheForTests,ht as getWorktreeSuffix,z as hashProjectDirCanonical,Y as hashProjectDirLegacy,y as normalizeWorktreePath,Nt as resolveContentStorePath,wt as resolveSessionDbPath,mt as resolveSessionPath};
