#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""P3-H Phase 19 / Task A: patch integrity verification (read-only).

Eight checks required by the phase-19 instruction:
  A1 dependency paths resolvable
  A2 PowerShell 5.1 can parse every .ps1
  A3 ASCII / BOM encoding matches the real execution environment
  A4 diff contains only the approved 8022 fix
  A5 no hardcoded production path that would make isolation tests write to prod
  A6 no credential / token / session / production database material
  A7 module version matches patch version
  A8 original script still traceable by SHA-256

This script only reads. It never writes into the isolation directory except the
JSON/LOG report passed with --out / --log (default: alongside this script).
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OFFICIAL = r"D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"

# SHA-256 recorded at the end of phase 18; anything else means unexpected drift.
BASELINE = {
    "PATCH-v2.diff": ("1e8e4900e08d", 5494),
    "PATCH-v3.diff": ("c24d3854f5e0", 6472),
    "PATCH.diff": ("d43c37ab7d5f", 4557),
    "TEST_RESULTS_2026-10-27.json": ("5ec3ad1e7381", 6951),
    "TEST_RESULTS_2026-10-27.log": ("c486f460036b", 3619),
    "TEST_RESULTS_PHASE18_2026-10-27.json": ("ba1f0478a0da", 12111),
    "TEST_RESULTS_PHASE18_2026-10-27.log": ("91898ee451f1", 12546),
    "TEST_RESULTS_PHASE18_OWNERSHIP_RERUN2_2026-10-27.json": ("7a00498df502", 12115),
    "TEST_RESULTS_PHASE18_OWNERSHIP_RERUN_2026-10-27.json": ("9a8b5947124a", 12085),
    "TEST_RESULTS_PHASE18_RERUN_2026-10-27.json": ("bf13f10f5a6a", 15588),
    "Test-V15CLauncherOwnership.ps1": ("3157570af275", 40813),
    "Test-V15CPhase18Adoption.ps1": ("48a1e4e0a4d4", 50025),
    "V15C-Adoption.ps1": ("48cb7c34732d", 22949),
    "V15C-Ownership.ps1": ("adf7f8ecd6bc", 19902),
    "fake_manage.py": ("02c2cac6d8d6", 1197),
    "fake_project.py": ("edeb68370953", 2069),
    "start_fde_v15c_classroom.original.ps1": ("a64330ef7a31", 15766),
    "start_fde_v15c_classroom.patched-v2.ps1": ("19124aed6aa6", 18771),
    "start_fde_v15c_classroom.patched-v3.ps1": ("a95a857b11de", 19736),
    "start_fde_v15c_classroom.patched.ps1": ("5d1fc53dd32a", 17846),
}

OFFICIAL_SHA = "a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59"
OFFICIAL_BYTES = 15766

# Production write targets that must never appear as a write target inside the
# isolation harness. $StateRoot / $V15Root / $DjangoPython in the *launcher* are
# the genuine production configuration inherited from the original file, so they
# are allowed there but forbidden in the test scripts.
PROD_STATE_ROOT = r"C:\Users\admin\AppData\Local\FDE-AI\classroom"
PROD_V15_ROOT = r"D:\FDE-AI-UAS\v1.5C\student_portal"
PROD_DB = r"FDE-AI-v1.5\student_portal\db.sqlite3"
PROD_MEDIA = r"FDE-AI-v1.5\student_portal\private_media"

CRED_PATTERNS = [
    r"(?i)\bpassword\s*=\s*['\"][^'\"]{3,}",
    r"(?i)\bpasswd\s*=\s*['\"][^'\"]{3,}",
    r"(?i)\bapi[_-]?key\s*=\s*['\"][^'\"]{8,}",
    r"(?i)\bsecret\s*=\s*['\"][^'\"]{8,}",
    r"(?i)\bbearer\s+[A-Za-z0-9\-_\.]{16,}",
    r"(?i)\bsk-[A-Za-z0-9]{16,}",
    r"(?i)oauth_token\s*=\s*['\"][^'\"]{8,}",
    r"(?i)\bsessionid\s*=\s*['\"][^'\"]{8,}",
    r"(?i)\bghp_[A-Za-z0-9]{20,}",
    r"(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----",
]


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def read_bytes(p):
    with open(p, "rb") as f:
        return f.read()


def detect_bom(data):
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-bom"
    if data.startswith(b"\xff\xfe"):
        return "utf-16le-bom"
    if data.startswith(b"\xfe\xff"):
        return "utf-16be-bom"
    return "none"


def decode_text(data):
    bom = detect_bom(data)
    if bom == "utf-16le-bom":
        return data.decode("utf-16"), bom
    if bom == "utf-16be-bom":
        return data.decode("utf-16"), bom
    if bom == "utf-8-bom":
        return data.decode("utf-8-sig"), bom
    return data.decode("utf-8", "replace"), bom


def check_encoding(name, data):
    text, bom = decode_text(data)
    non_ascii = sum(1 for ch in text if ord(ch) > 127)
    return {
        "file": name,
        "bytes": len(data),
        "bom": bom,
        "non_ascii": non_ascii,
    }


def ps_parse_check(paths):
    """Run [Parser]::ParseFile over every script inside a single PS 5.1 process."""
    list_file = os.path.join(tempfile.gettempdir(), "p3h19_parse_list.txt")
    out_json = os.path.join(tempfile.gettempdir(), "p3h19_parse_result.json")
    with open(list_file, "w", encoding="utf-8") as f:
        for p in paths:
            f.write(p + "\n")
    script = os.path.join(tempfile.gettempdir(), "p3h19_parse.ps1")
    body = (
        "$ErrorActionPreference='Continue'\n"
        "$ProgressPreference='SilentlyContinue'\n"
        "$paths = Get-Content -LiteralPath '%s' | Where-Object { $_ -ne '' }\n"
        "$rows = @()\n"
        "foreach ($p in $paths) {\n"
        "  $errs = $null\n"
        "  $tokens = $null\n"
        "  try {\n"
        "    [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errs)\n"
        "  } catch { $errs = @($_) }\n"
        "  $msgs = @()\n"
        "  if ($errs) { foreach ($e in $errs) { $msgs += ('' + $e.Message) } }\n"
        "  $rows += [pscustomobject]@{ file = (Split-Path -Leaf $p); ok = ($msgs.Count -eq 0); errors = $msgs }\n"
        "}\n"
        "$rows | ConvertTo-Json -Depth 5 | Out-File -FilePath '%s' -Encoding utf8\n"
        "'PARSE_DONE'\n"
    ) % (list_file, out_json)
    with open(script, "w", encoding="ascii") as f:
        f.write(body)
    r = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
        capture_output=True, text=True, timeout=300,
    )
    if not os.path.exists(out_json):
        return {"error": "no_result", "stdout": r.stdout[-2000:], "stderr": r.stderr[-2000:]}
    with open(out_json, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def parse_diff(path):
    hunks = []
    cur = None
    added = []
    removed = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("@@"):
                if cur is not None:
                    hunks.append(cur)
                cur = {"header": line, "added": list(added), "removed": list(removed)}
                added, removed = [], []
            elif cur is not None:
                if line.startswith("+") and not line.startswith("+++"):
                    cur["added"].append(line[1:])
                elif line.startswith("-") and not line.startswith("---"):
                    cur["removed"].append(line[1:])
    if cur is not None:
        hunks.append(cur)
    return hunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "VERIFY_RESULTS_PHASE19_TASKA.json"))
    ap.add_argument("--log", default=os.path.join(HERE, "VERIFY_RESULTS_PHASE19_TASKA.log"))
    args = ap.parse_args()

    results = {}
    lines = []

    def emit(s):
        lines.append(s)
        print(s)

    # ---- A8 / baseline: every file still matches the phase-18 record ----
    drift = []
    enc = []
    files = sorted(os.listdir(HERE))
    for name in files:
        p = os.path.join(HERE, name)
        if not os.path.isfile(p):
            continue
        data = read_bytes(p)
        h = sha256_bytes(data)
        exp = BASELINE.get(name)
        if exp is None:
            if name.startswith("VERIFY_RESULTS_PHASE19"):
                continue
            drift.append({"file": name, "reason": "not_in_phase18_baseline", "sha256": h})
        elif not (h.startswith(exp[0]) and len(data) == exp[1]):
            drift.append({"file": name, "reason": "sha_or_size_mismatch",
                          "expected": exp, "actual": [h[:12], len(data)]})
        if name.lower().endswith((".ps1", ".py", ".diff", ".json", ".log")):
            enc.append(check_encoding(name, data))

    results["baseline_drift"] = drift
    emit("[A0] baseline drift entries: %d" % len(drift))
    for d in drift:
        emit("     DRIFT %s" % json.dumps(d, ensure_ascii=False))

    # ---- A3 encoding ----
    # A3 applies to *executed* scripts only: PowerShell 5.1 with -File mis-parses
    # a BOM-less non-ASCII .ps1. Data artefacts (json/log) are outputs, not code,
    # so they are reported separately and never fail A3.
    scripts = [e for e in enc if e["file"].lower().endswith((".ps1", ".py"))]
    datafiles = [e for e in enc if not e["file"].lower().endswith((".ps1", ".py"))]
    enc_bad = [e for e in scripts if e["bom"] != "none" or e["non_ascii"] != 0]
    results["encoding_scripts"] = scripts
    results["encoding_datafiles"] = datafiles
    results["A3_pass"] = len(enc_bad) == 0
    emit("[A3] executed scripts=%d  bom!=none or non_ascii!=0: %d -> %s"
         % (len(scripts), len(enc_bad), "PASS" if len(enc_bad) == 0 else "FAIL"))
    for e in enc_bad:
        emit("     BAD %s bom=%s non_ascii=%d" % (e["file"], e["bom"], e["non_ascii"]))
    emit("[A3i] data artefacts (not executed, informational): %d" % len(datafiles))
    for e in datafiles:
        emit("      %-52s bom=%-12s non_ascii=%d" % (e["file"], e["bom"], e["non_ascii"]))

    # ---- A2 PS 5.1 parse ----
    ps1 = [os.path.join(HERE, f) for f in files if f.lower().endswith(".ps1")]
    ps1.append(OFFICIAL)
    parsed = ps_parse_check(ps1)
    if isinstance(parsed, dict) and parsed.get("error"):
        results["A2_pass"] = False
        results["parse"] = parsed
        emit("[A2] parse harness error: %s" % parsed.get("error"))
    else:
        if isinstance(parsed, dict):
            parsed = [parsed]
        bad = [r for r in parsed if not r["ok"]]
        results["parse"] = parsed
        results["A2_pass"] = len(bad) == 0
        emit("[A2] scripts parsed=%d  failures=%d -> %s"
             % (len(parsed), len(bad), "PASS" if len(bad) == 0 else "FAIL"))
        for r in bad:
            emit("     PARSE FAIL %s :: %s" % (r["file"], r["errors"]))

    # ---- A1 dependency resolution ----
    pv3 = os.path.join(HERE, "start_fde_v15c_classroom.patched-v3.ps1")
    pv3_text = read_bytes(pv3).decode("utf-8")
    dot = re.findall(r"\.\s*\$(\w+)", pv3_text)
    mod_vars = [(v, r) for v, r in
                re.findall(r"\$(\w+)\s*=\s*Join-Path\s+\$GatewayRoot\s+'([^']+)'", pv3_text)
                if r.lower().endswith(".ps1")]
    deps = []
    for var, rel in mod_vars:
        target = os.path.join(HERE, rel)
        deps.append({
            "declared_var": var,
            "relative": rel,
            "resolved": target,
            "exists": os.path.exists(target),
            "dot_sourced": var in dot,
            "guard": ("Test-Path -LiteralPath $%s" % var) in pv3_text,
        })
    results["dependencies"] = deps
    a1_ok = all(d["exists"] and d["dot_sourced"] and d["guard"] for d in deps) and len(deps) >= 2
    results["A1_pass"] = a1_ok
    emit("[A1] declared modules=%d  all exist+dot-sourced+guarded=%s -> %s"
         % (len(deps), all(d["exists"] for d in deps), "PASS" if a1_ok else "FAIL"))
    for d in deps:
        emit("     %s -> %s exists=%s dot=%s guard=%s"
             % (d["relative"], d["resolved"], d["exists"], d["dot_sourced"], d["guard"]))

    # functions each module must provide, per the launcher call sites
    required_funcs = {
        "V15C-Ownership.ps1": ["Test-IsV15CDjango", "Write-V15CStateRecord",
                               "Read-V15CStateRecord", "Get-V15CListenerPid",
                               "Get-V15CProcessInfo", "Test-V15CHealth",
                               "Test-V15CProcessAlive"],
        "V15C-Adoption.ps1": ["Test-V15CAdoptionEligible", "Resolve-V15CListenerAction",
                              "Invoke-V15CAdoptionClaim"],
    }
    fn_report = {}
    for mod, fns in required_funcs.items():
        txt = read_bytes(os.path.join(HERE, mod)).decode("utf-8")
        fn_report[mod] = {fn: bool(re.search(r"function\s+%s\b" % re.escape(fn), txt)) for fn in fns}
    results["module_functions"] = fn_report
    a1b = all(all(v.values()) for v in fn_report.values())
    results["A1_functions_pass"] = a1b
    emit("[A1b] required exported functions present=%s -> %s" % (a1b, "PASS" if a1b else "FAIL"))
    for mod, fns in fn_report.items():
        miss = [k for k, v in fns.items() if not v]
        if miss:
            emit("     MISSING in %s: %s" % (mod, ", ".join(miss)))

    # ---- A4 diff scope ----
    hunks = parse_diff(os.path.join(HERE, "PATCH-v3.diff"))
    approved_markers = [
        "$DjangoPidStateFile", "$EnableAdoption", "$OwnershipModule", "$AdoptionModule",
        "Test-IsV15CDjango", "Test-V15CAdoptionEligible", "Resolve-V15CListenerAction",
        "Invoke-V15CAdoptionClaim", "Write-V15CStateRecord", "PID STATE",
        "$startedListener", "$startedProc", "$startedCreated", "$stateClaim",
        "$verdict", "$reasonSummary", "$adoption", "$decision", "$claim",
        "P3-H Phase 17", "P3-H Phase 18",
    ]
    scope_issues = []
    total_add = 0
    total_del = 0
    for i, h in enumerate(hunks, 1):
        total_add += len(h["added"])
        total_del += len(h["removed"])
        for ln in h["added"]:
            s = ln.strip()
            if not s or s.startswith("#") or s in ("}", "}", "} else {", "} elseif ($decision.Action -eq 'ADOPT') {"):
                continue
            if any(m in ln for m in approved_markers):
                continue
            scope_issues.append({"hunk": i, "kind": "added", "line": ln})
        for ln in h["removed"]:
            s = ln.strip()
            if not s or s.startswith("#"):
                continue
            # only the auto-kill block may be removed
            if any(k in ln for k in ("$expectedDjangoExe", "Get-Process", "$ownerPath",
                                     "STOPPING stale 8022", "Stop-Process",
                                     "non-v1.5C process", "$django = Get-Listener",
                                     "if ($django) {", "if ($ownerPath",
                                     "Start-Sleep -Seconds 2")):
                continue
            scope_issues.append({"hunk": i, "kind": "removed", "line": ln})

    # The two pre-existing cloudflared Stop-Process calls (kill-old-tunnel and
    # failed-attempt cleanup) are residual risk reviewed in phase 18 and are
    # explicitly OUT OF SCOPE for this patch. The patch must not touch them.
    tunnel_tokens = ("$existingTunnel.ProcessId", "$startedTunnel.Id")
    tunnel_touched = any(tok in ln for h in hunks for ln in h["added"] + h["removed"]
                         for tok in tunnel_tokens)
    # and they must still be present, unmodified, in the patched file
    tunnel_present = {
        "$existingTunnel.ProcessId": "$existingTunnel.ProcessId" in pv3_text,
        "$startedTunnel.Id": "$startedTunnel.Id" in pv3_text,
    }
    results["diff"] = {
        "hunks": len(hunks),
        "added_lines": total_add,
        "removed_lines": total_del,
        "scope_issues": scope_issues,
        "tunnel_stop_process_touched_by_patch": tunnel_touched,
        "tunnel_stop_process_still_present": tunnel_present,
    }
    a4_ok = (len(scope_issues) == 0 and not tunnel_touched
             and len(hunks) == 3 and all(tunnel_present.values()))
    results["A4_pass"] = a4_ok
    emit("[A4] hunks=%d +%d -%d  scope_issues=%d  tunnel_touched=%s tunnel_present=%s -> %s"
         % (len(hunks), total_add, total_del, len(scope_issues), tunnel_touched,
            tunnel_present, "PASS" if a4_ok else "FAIL"))
    for s in scope_issues:
        emit("     SCOPE %s" % json.dumps(s, ensure_ascii=False))

    # ---- A5 hardcoded production write targets ----
    # A production path is only dangerous when it is a WRITE target. A path used
    # as a read-only probe, or as a literal fixture string injected into a fake
    # process-info provider, cannot write anything. Classify every hit.
    WRITE_VERBS = re.compile(
        r"(?i)(Set-Content|Out-File|Add-Content|New-Item|Remove-Item|Copy-Item|Move-Item|"
        r"Write-V15CStateRecord|Set-Item|Clear-Content|Rename-Item)\b")
    a5_hits = []
    a5_writes = []
    for name in files:
        if not name.lower().endswith((".ps1", ".py")):
            continue
        if name.startswith("start_fde_v15c_classroom") or name.startswith("verify_p3h19_"):
            # the launcher legitimately carries the production config;
            # this verifier only holds the tokens as search needles.
            continue
        txt = read_bytes(os.path.join(HERE, name)).decode("utf-8", "replace")
        src_lines = txt.splitlines()
        for i, ln in enumerate(src_lines, 1):
            for token, label in ((PROD_STATE_ROOT, "prod_state_root"),
                                 (PROD_V15_ROOT, "prod_v15_root"),
                                 (PROD_DB, "prod_db"),
                                 (PROD_MEDIA, "prod_media")):
                if token.lower() not in ln.lower():
                    continue
                kind = "read_only_probe_or_fixture"
                if WRITE_VERBS.search(ln):
                    kind = "write_target"
                # a fixture assignment that is only later passed as a provider
                # argument is harmless; a write verb on the same line is not.
                rec = {"file": name, "line_no": i, "token": label,
                       "kind": kind, "text": ln.strip()[:200]}
                a5_hits.append(rec)
                if kind == "write_target":
                    a5_writes.append(rec)
    results["A5_hits"] = a5_hits
    results["A5_write_targets"] = a5_writes
    results["A5_pass"] = len(a5_writes) == 0
    emit("[A5] production-path references in isolation scripts: %d "
         "(write targets: %d) -> %s"
         % (len(a5_hits), len(a5_writes), "PASS" if len(a5_writes) == 0 else "FAIL"))
    for it in a5_hits:
        emit("     %-10s %s:%d [%s] %s"
             % (it["kind"], it["file"], it["line_no"], it["token"], it["text"]))

    # the launcher itself: production paths must be inherited-only, i.e. identical
    # to the original file. Compare the assignment lines.
    orig_text = read_bytes(os.path.join(HERE, "start_fde_v15c_classroom.original.ps1")).decode("utf-8")
    launcher_path_lines = {}
    for token, label in ((PROD_STATE_ROOT, "prod_state_root"),
                         (PROD_V15_ROOT, "prod_v15_root"),
                         (PROD_DB, "prod_db"),
                         (PROD_MEDIA, "prod_media")):
        in_orig = [l.strip() for l in orig_text.splitlines() if token.lower() in l.lower()]
        in_pv3 = [l.strip() for l in pv3_text.splitlines() if token.lower() in l.lower()]
        launcher_path_lines[label] = {"original": in_orig, "patched_v3": in_pv3,
                                      "identical": in_orig == in_pv3}
    results["A5_launcher_inheritance"] = launcher_path_lines
    a5b = all(v["identical"] for v in launcher_path_lines.values())
    results["A5_launcher_pass"] = a5b
    emit("[A5b] launcher production paths unchanged vs original=%s -> %s"
         % (a5b, "PASS" if a5b else "FAIL"))

    # A5c: Test-IsV15CDjango must be read-only with respect to -StateFile, so that
    # the T19 production probe cannot mutate the production state record.
    own_src = read_bytes(os.path.join(HERE, "V15C-Ownership.ps1")).decode("utf-8")
    m = re.search(r"function\s+Test-IsV15CDjango\b(.*?)(?=\nfunction\s|\Z)", own_src, re.S)
    body = m.group(1) if m else ""
    write_in_body = [ln.strip() for ln in body.splitlines()
                     if WRITE_VERBS.search(ln) and not ln.strip().startswith("#")]
    reads_state = "Get-Content -Raw -LiteralPath $StateFile" in body
    a5c = len(write_in_body) == 0 and reads_state
    results["A5_ownership_readonly"] = {
        "test_is_v15c_django_body_lines": len(body.splitlines()),
        "write_verbs_in_body": write_in_body,
        "reads_state_file": reads_state,
    }
    results["A5_ownership_readonly_pass"] = a5c
    emit("[A5c] Test-IsV15CDjango write verbs on StateFile: %d, reads state=%s -> %s"
         % (len(write_in_body), reads_state, "PASS" if a5c else "FAIL"))
    for ln in write_in_body:
        emit("     WRITE %s" % ln)

    # ---- A6 credentials ----
    a6_hits = []
    for name in files:
        if not name.lower().endswith((".ps1", ".py", ".diff")):
            continue
        if name.startswith("verify_p3h19_"):
            continue  # this verifier holds the patterns themselves as needles
        txt, _ = decode_text(read_bytes(os.path.join(HERE, name)))
        for i, ln in enumerate(txt.splitlines(), 1):
            for pat in CRED_PATTERNS:
                if re.search(pat, ln):
                    a6_hits.append({"file": name, "line_no": i, "pattern": pat,
                                    "text": ln.strip()[:160]})
    results["A6_hits"] = a6_hits
    results["A6_pass"] = len(a6_hits) == 0
    emit("[A6] credential-like literals: %d -> %s"
         % (len(a6_hits), "PASS" if len(a6_hits) == 0 else "FAIL"))
    for h in a6_hits:
        emit("     %s:%d %s" % (h["file"], h["line_no"], h["text"]))

    # ---- A7 module / patch version match ----
    own = read_bytes(os.path.join(HERE, "V15C-Ownership.ps1")).decode("utf-8")
    ado = read_bytes(os.path.join(HERE, "V15C-Adoption.ps1")).decode("utf-8")
    a7 = {
        "ownership_has_version_banner": bool(re.search(r"P3-H\s+Phase\s*1[78]", own)),
        "adoption_has_version_banner": bool(re.search(r"P3-H\s+Phase\s*18", ado)),
        "adoption_delegates_to_single_writer": bool(
            re.search(r"Write-V15CStateRecord\s+-StateFile", ado)),
        "adoption_has_no_own_state_writer": not bool(
            re.search(r"function\s+Write-V15CAdoptionState\b", ado)),
        "ownership_defines_state_writer": bool(
            re.search(r"function\s+Write-V15CStateRecord\b", own)),
        "launcher_requires_both_modules": ("V15C-Ownership.ps1" in pv3_text
                                           and "V15C-Adoption.ps1" in pv3_text),
        "launcher_phase_tags": sorted(set(re.findall(r"P3-H Phase (\d+)", pv3_text))),
    }
    a7_ok = all(v for k, v in a7.items() if isinstance(v, bool))
    results["A7"] = a7
    results["A7_pass"] = a7_ok
    emit("[A7] module/patch version consistency=%s -> %s" % (a7_ok, "PASS" if a7_ok else "FAIL"))
    for k, v in a7.items():
        emit("     %-42s %s" % (k, v))

    # ---- A8 original traceable ----
    off = read_bytes(OFFICIAL)
    off_sha = sha256_bytes(off)
    iso = read_bytes(os.path.join(HERE, "start_fde_v15c_classroom.original.ps1"))
    a8 = {
        "official_path": OFFICIAL,
        "official_sha256": off_sha,
        "official_bytes": len(off),
        "official_matches_recorded": off_sha == OFFICIAL_SHA and len(off) == OFFICIAL_BYTES,
        "isolation_copy_sha256": sha256_bytes(iso),
        "isolation_copy_identical_to_official": sha256_bytes(iso) == off_sha,
        "patched_v3_still_traceable": "start_fde_v15c_classroom.original.ps1" in
                                      read_bytes(os.path.join(HERE, "PATCH-v3.diff")).decode("utf-8"),
    }
    results["A8"] = a8
    results["A8_pass"] = all([a8["official_matches_recorded"],
                              a8["isolation_copy_identical_to_official"],
                              a8["patched_v3_still_traceable"]])
    emit("[A8] official sha=%s bytes=%d recorded_match=%s isolation_identical=%s -> %s"
         % (off_sha[:16], len(off), a8["official_matches_recorded"],
            a8["isolation_copy_identical_to_official"],
            "PASS" if results["A8_pass"] else "FAIL"))

    summary = {
        "A1_dependency_paths": "PASS" if a1_ok and a1b else "FAIL",
        "A2_ps51_parse": "PASS" if results["A2_pass"] else "FAIL",
        "A3_ascii_bom": "PASS" if results["A3_pass"] else "FAIL",
        "A4_diff_scope": "PASS" if a4_ok else "FAIL",
        "A5_no_prod_write_from_isolation": "PASS" if (results["A5_pass"] and a5b and a5c) else "FAIL",
        "A6_no_credentials": "PASS" if results["A6_pass"] else "FAIL",
        "A7_version_match": "PASS" if a7_ok else "FAIL",
        "A8_original_traceable": "PASS" if results["A8_pass"] else "FAIL",
    }
    results["summary"] = summary
    emit("")
    emit("=== TASK A SUMMARY ===")
    for k, v in summary.items():
        emit("%-34s %s" % (k, v))
    passed = sum(1 for v in summary.values() if v == "PASS")
    emit("TOTAL %d/8 PASS" % passed)
    results["total_pass"] = passed

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    with open(args.log, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    emit("REPORT %s" % args.out)
    return 0 if passed == 8 else 1


if __name__ == "__main__":
    sys.exit(main())
