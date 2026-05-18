import{createRequire as V}from"node:module";import{existsSync as Q,unlinkSync as B,renameSync as Z}from"node:fs";import{tmpdir as J}from"node:os";import{join as tt}from"node:path";var w=class{#t;constructor(t){this.#t=t}pragma(t){let s=this.#t.prepare(`PRAGMA ${t}`).all();if(!s||s.length===0)return;if(s.length>1)return s;let r=Object.values(s[0]);return r.length===1?r[0]:s[0]}exec(t){let e="",s=null;for(let o=0;o<t.length;o++){let a=t[o];if(s)e+=a,a===s&&(s=null);else if(a==="'"||a==='"')e+=a,s=a;else if(a===";"){let c=e.trim();c&&this.#t.prepare(c).run(),e=""}else e+=a}let r=e.trim();return r&&this.#t.prepare(r).run(),this}prepare(t){let e=this.#t.prepare(t);return{run:(...s)=>e.run(...s),get:(...s)=>{let r=e.get(...s);return r===null?void 0:r},all:(...s)=>e.all(...s),iterate:(...s)=>e.iterate(...s)}}transaction(t){return this.#t.transaction(t)}close(){this.#t.close()}},A=class{#t;constructor(t){this.#t=t}pragma(t){let s=this.#t.prepare(`PRAGMA ${t}`).all();if(!s||s.length===0)return;if(s.length>1)return s;let r=Object.values(s[0]);return r.length===1?r[0]:s[0]}exec(t){return this.#t.exec(t),this}prepare(t){let e=this.#t.prepare(t);return{run:(...s)=>e.run(...s),get:(...s)=>e.get(...s),all:(...s)=>e.all(...s),iterate:(...s)=>typeof e.iterate=="function"?e.iterate(...s):e.all(...s)[Symbol.iterator]()}}transaction(t){return(...e)=>{this.#t.exec("BEGIN");try{let s=t(...e);return this.#t.exec("COMMIT"),s}catch(s){throw this.#t.exec("ROLLBACK"),s}}}close(){this.#t.close()}},m=null;function et(n){let t=null;try{return t=new n(":memory:"),t.exec("CREATE VIRTUAL TABLE __fts5_probe USING fts5(x)"),!0}catch{return!1}finally{try{t?.close()}catch{}}}function st(n,t){let e=t!==void 0?t:globalThis.Bun;if(typeof e<"u"&&e!==null)return!0;let s=n??process.versions,[r,o]=(s.node??"0.0.0").split("."),a=Number(r),c=Number(o);return!Number.isFinite(a)||!Number.isFinite(c)?!1:a>22||a===22&&c>=5}function nt(){if(!m){let n=V(import.meta.url);if(globalThis.Bun){let t=n(["bun","sqlite"].join(":")).Database;m=function(s,r){let o=new t(s,{readonly:r?.readonly,create:!0}),a=new w(o);return r?.timeout&&a.pragma(`busy_timeout = ${r.timeout}`),a}}else if(st()){let t=null;try{({DatabaseSync:t}=n(["node","sqlite"].join(":")))}catch{t=null}t&&et(t)?m=function(s,r){let o=new t(s,{readOnly:r?.readonly??!1});return new A(o)}:m=n("better-sqlite3")}else m=n("better-sqlite3")}return m}function rt(n){n.pragma("journal_mode = WAL"),n.pragma("synchronous = NORMAL");try{n.pragma("mmap_size = 268435456")}catch{}}function U(n){if(!Q(n))for(let t of["-wal","-shm"])try{B(n+t)}catch{}}function it(n){for(let t of["","-wal","-shm"])try{B(n+t)}catch{}}function T(n){try{n.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{n.close()}catch{}}function F(n="context-mode"){return tt(J(),`${n}-${process.pid}.db`)}function ot(n){if(!(n<=0))try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,n)}catch{let t=Date.now();for(;Date.now()-t<n;);}}function P(n,t=[50,100,250,500,1e3,2e3,4e3]){let e;for(let s=0;s<=t.length;s++)try{return n()}catch(r){let o=r instanceof Error?r.message:String(r);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw r;e=r instanceof Error?r:new Error(o),s<t.length&&ot(t[s])}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${e?.message}`)}function M(n,t,e={}){return P(()=>{let s=new n(t,{timeout:e.busyTimeoutMs??3e4});try{return rt(s),s}catch(r){throw T(s),r}},e.retryDelays)}function at(n){return n.includes("SQLITE_CORRUPT")||n.includes("SQLITE_NOTADB")||n.includes("database disk image is malformed")||n.includes("file is not a database")}function ct(n){let t=Date.now();for(let e of["","-wal","-shm"])try{Z(n+e,`${n}${e}.corrupt-${t}`)}catch{}}var y=Symbol.for("__context_mode_live_dbs_v3__"),N=(()=>{let n=globalThis;return n[y]||(n[y]=new Set,process.on("exit",()=>{for(let t of n[y])T(t);n[y].clear()})),n[y]})(),b=class{#t;#e;#s;constructor(t,e={}){let s=nt();this.#t=t,this.#s=e.retryDelays,U(t);let r;try{r=M(s,t,e)}catch(o){let a=o instanceof Error?o.message:String(o);if(at(a)){ct(t),U(t);try{r=M(s,t,e)}catch(c){throw new Error(`Failed to create fresh DB after renaming corrupt file: ${c instanceof Error?c.message:String(c)}`)}}else throw o}this.#e=r,N.add(this.#e),this.withRetry(()=>this.initSchema()),this.prepareStatements()}get db(){return this.#e}get dbPath(){return this.#t}close(){N.delete(this.#e),T(this.#e)}withRetry(t){return P(t,this.#s)}cleanup(){N.delete(this.#e),T(this.#e),it(this.#t)}};import{createHash as f}from"node:crypto";import{execFileSync as ut}from"node:child_process";import{existsSync as _,realpathSync as dt,renameSync as R}from"node:fs";import{join as L}from"node:path";function k(n){let t=n.replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API[_-]?KEY|AUTH|COOKIE|CREDENTIAL)[A-Z0-9_]*=)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,"$1<redacted>");return t=t.replace(/(https?:\/\/)([^:\s/@]+):([^@\s]+)@/gi,"$1<user>:<redacted>@"),t=t.replace(/(--(?:token|password|secret|api-key|auth|cookie)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi,"$1<redacted>"),t}var p;function g(n){let t=n.replace(/\\/g,"/");return/^\/+$/.test(t)?"/":/^[A-Za-z]:\/+$/.test(t)?`${t.slice(0,2)}/`:t.replace(/\/+$/,"")}function j(n){let t=n;try{t=dt.native(n)}catch{}let e=g(t);return process.platform==="win32"||process.platform==="darwin"?e.toLowerCase():e}function Y(n,t){return ut("git",["-C",n,...t],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).trim()}var lt=new Set(["rawcommand","raw_command","rawoutput","raw_output","rawstdout","raw_stdout","rawstderr","raw_stderr","rawstdin","raw_stdin"]);function O(n,t){let e=n.toLowerCase();if(lt.has(e))return"<redacted:trace-forbidden-field>";if(e==="command"&&typeof t=="string")return k(t);if(Array.isArray(t))return t.map(s=>O("",s));if(t&&typeof t=="object"){let s={};for(let[r,o]of Object.entries(t))s[r]=O(r,o);return s}return t}function W(n){try{let t=JSON.parse(n);return!t||typeof t!="object"?n:JSON.stringify(O("",t))}catch{return n}}function Et(n){let t=Y(n,["rev-parse","--show-toplevel"]);return t.length>0?g(t):null}function mt(n){let t=Y(n,["worktree","list","--porcelain"]).split(/\r?\n/).find(e=>e.startsWith("worktree "))?.replace("worktree ","")?.trim();return t?g(t):null}function pt(n=process.cwd()){let t=process.env.CONTEXT_MODE_SESSION_SUFFIX;if(p&&p.projectDir===n&&p.envSuffix===t)return p.suffix;let e="";if(t!==void 0)e=t?`__${t}`:"";else try{let s=Et(n),r=mt(n);if(s&&r){let o=j(s),a=j(r);o!==a&&(e=`__${f("sha256").update(o).digest("hex").slice(0,8)}`)}}catch{}return p={projectDir:n,envSuffix:t,suffix:e},e}function Nt(){p=void 0}function G(n){return f("sha256").update(g(n)).digest("hex").slice(0,16)}function z(n){let t=g(n),e=process.platform==="darwin"||process.platform==="win32"?t.toLowerCase():t;return f("sha256").update(e).digest("hex").slice(0,16)}function wt(n){let{projectDir:t,contentDir:e}=n,s=z(t),r=L(e,`${s}.db`);if(_(r))return r;let o=G(t);if(o===s)return r;let a=L(e,`${o}.db`);if(_(a))try{R(a,r);for(let c of["-wal","-shm"])try{R(a+c,r+c)}catch{}}catch{}return r}function At(n){return _t({...n,ext:".db"})}function _t(n){let{projectDir:t,sessionsDir:e,ext:s}=n,r=n.suffix??pt(t),o=z(t),a=L(e,`${o}${r}${s}`);if(_(a))return a;let c=G(t);if(c===o)return a;let d=L(e,`${c}${r}${s}`);if(_(d))try{R(d,a);for(let l of["-wal","-shm"]){let u=`${d}${l}`,E=`${a}${l}`;_(u)&&!_(E)&&R(u,E)}}catch{}return a}var H=1e3,X=5;function S(n){let t=Number(n);return!Number.isFinite(t)||t<=0?0:Math.floor(t)}var i={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",getLatestAttributedProject:"getLatestAttributedProject",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",updateMetaLastEvents:"updateMetaLastEvents",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",claimLatestUnconsumedResume:"claimLatestUnconsumedResume",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions",searchEvents:"searchEvents",incrementToolCall:"incrementToolCall",getToolCallTotals:"getToolCallTotals",getToolCallByTool:"getToolCallByTool",getEventBytesSummary:"getEventBytesSummary",listSessions:"listSessions",getEventsSince:"getEventsSince",getLatestEvents:"getLatestEvents"},$=class extends b{constructor(t){super(t?.dbPath??F("session"),t)}stmt(t){return this.stmts.get(t)}initSchema(){try{let e=this.db.pragma("table_xinfo(session_events)").find(s=>s.name==="data_hash");e&&e.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
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
    `);try{let t=this.db.pragma("table_xinfo(session_events)"),e=new Set(t.map(s=>s.name));e.has("project_dir")||this.db.exec("ALTER TABLE session_events ADD COLUMN project_dir TEXT NOT NULL DEFAULT ''"),e.has("attribution_source")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'unknown'"),e.has("attribution_confidence")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_confidence REAL NOT NULL DEFAULT 0"),e.has("bytes_avoided")||this.db.exec("ALTER TABLE session_events ADD COLUMN bytes_avoided INTEGER NOT NULL DEFAULT 0"),e.has("bytes_returned")||this.db.exec("ALTER TABLE session_events ADD COLUMN bytes_returned INTEGER NOT NULL DEFAULT 0"),this.db.exec("CREATE INDEX IF NOT EXISTS idx_session_events_project ON session_events(session_id, project_dir)")}catch{}}prepareStatements(){this.stmts=new Map;let t=(e,s)=>{this.stmts.set(e,this.db.prepare(s))};t(i.insertEvent,`INSERT INTO session_events (
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
       FROM session_events WHERE session_id = ? ORDER BY id DESC LIMIT ?`)}insertEvent(t,e,s="PostToolUse",r,o){let a=W(e.data),c=f("sha256").update(a).digest("hex").slice(0,16).toUpperCase(),d=String(r?.projectDir??e.project_dir??"").trim(),l=String(r?.source??e.attribution_source??"unknown"),u=Number(r?.confidence??e.attribution_confidence??0),E=Number.isFinite(u)?Math.max(0,Math.min(1,u)):0,h=S(o?.bytesAvoided),v=S(o?.bytesReturned),C=this.db.transaction(()=>{if(this.stmt(i.checkDuplicate).get(t,X,e.type,c))return;this.stmt(i.getEventCount).get(t).cnt>=H&&this.stmt(i.evictLowestPriority).run(t),this.stmt(i.insertEvent).run(t,e.type,e.category,e.priority,a,d,l,E,h,v,s,c),this.stmt(i.updateMetaLastEvent).run(t)});this.withRetry(()=>C())}bulkInsertEvents(t,e,s="PostToolUse",r,o){if(!e||e.length===0)return;if(e.length===1){this.insertEvent(t,e[0],s,r?.[0],o?.[0]);return}let a=e.map((d,l)=>{let u=W(d.data),E=f("sha256").update(u).digest("hex").slice(0,16).toUpperCase(),h=r?.[l],v=String(h?.projectDir??d.project_dir??"").trim(),C=String(h?.source??d.attribution_source??"unknown"),D=Number(h?.confidence??d.attribution_confidence??0),I=Number.isFinite(D)?Math.max(0,Math.min(1,D)):0,x=o?.[l],K=S(x?.bytesAvoided),q=S(x?.bytesReturned);return{event:d,eventData:u,dataHash:E,projectDir:v,attributionSource:C,attributionConfidence:I,bytesAvoided:K,bytesReturned:q}}),c=this.db.transaction(()=>{let d=this.stmt(i.getEventCount).get(t).cnt,l=0;for(let u of a)this.stmt(i.checkDuplicate).get(t,X,u.event.type,u.dataHash)||(d>=H?this.stmt(i.evictLowestPriority).run(t):d++,this.stmt(i.insertEvent).run(t,u.event.type,u.event.category,u.event.priority,u.eventData,u.projectDir,u.attributionSource,u.attributionConfidence,u.bytesAvoided,u.bytesReturned,s,u.dataHash),l++);l>0&&this.stmt(i.updateMetaLastEvents).run(l,t)});this.withRetry(()=>c())}getEvents(t,e){let s=e?.limit??1e3,r=e?.type,o=e?.minPriority;return r&&o!==void 0?this.stmt(i.getEventsByTypeAndPriority).all(t,r,o,s):r?this.stmt(i.getEventsByType).all(t,r,s):o!==void 0?this.stmt(i.getEventsByPriority).all(t,o,s):this.stmt(i.getEvents).all(t,s)}getEventCount(t){return this.stmt(i.getEventCount).get(t).cnt}getEventBytesSummary(t){let e=this.stmt(i.getEventBytesSummary).get(t);return{bytesAvoided:Number(e?.bytes_avoided??0),bytesReturned:Number(e?.bytes_returned??0)}}getLatestAttributedProjectDir(t){return this.stmt(i.getLatestAttributedProject).get(t)?.project_dir||null}searchEvents(t,e,s,r){try{let o=t.replace(/[%_]/g,c=>"\\"+c),a=r??null;return this.stmt(i.searchEvents).all(s,o,o,a,a,e)}catch{return[]}}ensureSession(t,e){this.withRetry(()=>this.stmt(i.ensureSession).run(t,e))}getSessionStats(t){return this.stmt(i.getSessionStats).get(t)??null}incrementCompactCount(t){this.withRetry(()=>this.stmt(i.incrementCompactCount).run(t))}upsertResume(t,e,s){this.withRetry(()=>this.stmt(i.upsertResume).run(t,e,s??0))}getResume(t){return this.stmt(i.getResume).get(t)??null}markResumeConsumed(t){this.withRetry(()=>this.stmt(i.markResumeConsumed).run(t))}claimLatestUnconsumedResume(t){let e=this.withRetry(()=>this.stmt(i.claimLatestUnconsumedResume).get(t));return e?{sessionId:e.session_id,snapshot:e.snapshot}:null}getLatestSessionId(){try{return this.db.prepare("SELECT session_id FROM session_meta ORDER BY started_at DESC, rowid DESC LIMIT 1").get()?.session_id??null}catch{return null}}listSessions(t=50){try{return this.stmt(i.listSessions).all(t)}catch{return[]}}getEventsSince(t,e=5e3){try{return this.stmt(i.getEventsSince).all(t,e)}catch{return[]}}getLatestEvents(t,e=1e3){try{return this.stmt(i.getLatestEvents).all(t,e).reverse()}catch{return[]}}incrementToolCall(t,e,s=0){let r=Number.isFinite(s)&&s>0?Math.round(s):0;try{this.withRetry(()=>this.stmt(i.incrementToolCall).run(t,e,r))}catch{}}getToolCallStats(t){try{let e=this.stmt(i.getToolCallTotals).get(t),s=this.stmt(i.getToolCallByTool).all(t),r={};for(let o of s)r[o.tool]={calls:o.calls,bytesReturned:o.bytes_returned};return{totalCalls:e?.calls??0,totalBytesReturned:e?.bytes_returned??0,byTool:r}}catch{return{totalCalls:0,totalBytesReturned:0,byTool:{}}}}deleteSession(t){let e=this.db.transaction(()=>{this.stmt(i.deleteEvents).run(t),this.stmt(i.deleteResume).run(t),this.stmt(i.deleteMeta).run(t)});this.withRetry(()=>e())}cleanupOldSessions(t=7){let e=`-${t}`,s=this.stmt(i.getOldSessions).all(e);for(let{session_id:r}of s)this.deleteSession(r);return s.length}};export{$ as SessionDB,Nt as _resetWorktreeSuffixCacheForTests,pt as getWorktreeSuffix,z as hashProjectDirCanonical,G as hashProjectDirLegacy,g as normalizeWorktreePath,wt as resolveContentStorePath,At as resolveSessionDbPath,_t as resolveSessionPath};
