# -*- coding: utf-8 -*-
"""Pure-Python Office, Slides, Spreadsheet & Attachment Viewer Engine.

Parses PPTX, DOCX, XLSX, CSV, TXT/MD/JSON, ZIP, and legacy OLE (.ppt/.doc)
files purely in Python (stdlib zipfile + ElementTree + openpyxl + Pillow) so it
runs identically in Docker (without LibreOffice) and local dev off the event
loop via asyncio.to_thread().
"""
from __future__ import annotations

import csv
import io
import logging
import posixpath
import re
import shutil
import zipfile
from typing import Any, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)

# Namespaces used across OpenXML Presentation & Wordprocessing documents
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
}

_ARABIC_PERSIAN_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")
_PRINTABLE_CHUNK_RE = re.compile(r"[\w\u0600-\u06FF\u200c\s.,;:!?()\[\]{}/%+\-_=*@#«»\"'،؛؟]{4,}")

_BROWSER_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"}
_IMAGE_MIMES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "bmp": "image/bmp",
}

DEFAULT_THEME_COLORS: Dict[str, str] = {
    "dk1": "#111827",
    "lt1": "#FFFFFF",
    "dk2": "#1F2937",
    "lt2": "#F3F4F6",
    "accent1": "#2563EB",
    "accent2": "#0D9488",
    "accent3": "#D97706",
    "accent4": "#7C3AED",
    "accent5": "#059669",
    "accent6": "#DC2626",
    "hlink": "#2563EB",
    "folHlink": "#7C3AED",
    "tx1": "#111827",
    "bg1": "#FFFFFF",
    "tx2": "#374151",
    "bg2": "#F3F4F6",
}


def has_libreoffice() -> bool:
    return bool(shutil.which("soffice") or shutil.which("libreoffice"))


def _has_rtl_chars(text: str) -> bool:
    return bool(_ARABIC_PERSIAN_RE.search(text or ""))


def _local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def detect_web_kind(mime: str = "", ext: str = "", content_type: str = "") -> str:
    """Classify any educational file into a rich web viewer kind."""
    m = (mime or "").strip().lower()
    e = (ext or "").strip().lower().lstrip(".")
    ct = (content_type or "").strip().lower()

    if m == "application/pdf" or e == "pdf":
        return "pdf"
    if m.startswith("video/") or e in {"mp4", "webm", "mkv", "mov", "m4v"}:
        return "video"
    if m.startswith("audio/") or e in {"mp3", "ogg", "oga", "wav", "m4a", "flac", "aac", "opus"}:
        return "audio"
    if m.startswith("image/") or e in {"jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"}:
        return "image"
    if (
        "presentationml" in m
        or "ms-powerpoint" in m
        or "opendocument.presentation" in m
        or e in {"pptx", "ppt", "ppsx", "pps", "odp"}
    ):
        return "slides"
    if (
        "spreadsheetml" in m
        or "ms-excel" in m
        or m in {"text/csv", "application/csv", "text/tab-separated-values"}
        or e in {"xlsx", "xlsm", "xls", "csv", "tsv"}
    ):
        return "sheet"
    if (
        "wordprocessingml" in m
        or "msword" in m
        or m in {"text/plain", "text/markdown", "application/rtf", "text/rtf", "application/json", "text/html", "application/xml"}
        or e in {"docx", "doc", "txt", "md", "markdown", "rtf", "json", "xml", "html", "htm", "log"}
    ):
        return "document"
    if "zip" in m or "rar" in m or "7z" in m or e in {"zip", "rar", "7z", "tar", "gz"}:
        return "archive"
    if ct == "ppt":
        return "slides"
    return "attachment"


def sniff_format_from_bytes(data: bytes, ext: str = "", mime: str = "") -> str:
    """Inspect magic bytes when extension/mime are missing or generic."""
    e = (ext or "").strip().lower().lstrip(".")
    if data[:4] == b"%PDF":
        return "pdf"
    if data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
                if "ppt/presentation.xml" in names:
                    return "pptx"
                if "word/document.xml" in names:
                    return "docx"
                if "xl/workbook.xml" in names:
                    return "xlsx"
                if any(n.startswith("ppt/slides/") for n in names):
                    return "pptx"
                if any(n.startswith("word/") for n in names):
                    return "docx"
                return "zip"
        except Exception:
            pass
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        if e in {"ppt", "pps"}:
            return "ppt"
        if e in {"xls"}:
            return "xls"
        if e in {"doc"}:
            return "doc"
        kind = detect_web_kind(mime, e)
        if kind == "slides":
            return "ppt"
        if kind == "sheet":
            return "xls"
        return "doc"
    if e in {"csv", "tsv"} or (mime or "").lower() in {"text/csv", "application/csv", "text/tab-separated-values"}:
        return "tsv" if e == "tsv" or "tab-separated" in (mime or "").lower() else "csv"
    if e in {"txt", "md", "markdown", "json", "xml", "html", "htm", "log"} or (mime or "").lower().startswith("text/"):
        return e or "txt"
    return e or "bin"


def _decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "utf-16", "cp1256", "windows-1256", "latin-1"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("utf-8", errors="replace")


def _safe_zip_member(base_dir: str, target: str) -> str:
    target = (target or "").replace("\\", "/")
    if target.startswith("/"):
        joined = target.lstrip("/")
    else:
        joined = posixpath.normpath(posixpath.join(base_dir, target))
    if joined.startswith("../") or joined == "..":
        return ""
    return joined


def _parse_rels(zf: zipfile.ZipFile, rel_path: str) -> Dict[str, str]:
    if rel_path not in zf.namelist():
        return {}
    try:
        root = ET.fromstring(zf.read(rel_path))
    except Exception:
        return {}
    rels: Dict[str, str] = {}
    for el in root:
        rid = el.attrib.get("Id")
        target = el.attrib.get("Target")
        if rid and target:
            rels[rid] = target
    return rels


def _parse_theme_colors(zf: zipfile.ZipFile) -> Dict[str, str]:
    colors = dict(DEFAULT_THEME_COLORS)
    theme_paths = sorted(n for n in zf.namelist() if n.startswith("ppt/theme/theme") and n.endswith(".xml"))
    if not theme_paths:
        return colors
    try:
        root = ET.fromstring(zf.read(theme_paths[0]))
        clr_scheme = root.find(".//a:clrScheme", NS)
        if clr_scheme is None:
            return colors
        for child in clr_scheme:
            cname = _local_tag(child.tag)
            srgb = child.find(".//a:srgbClr", NS)
            sys_clr = child.find(".//a:sysClr", NS)
            val = None
            if srgb is not None and srgb.attrib.get("val"):
                val = "#" + srgb.attrib["val"].lstrip("#")
            elif sys_clr is not None and sys_clr.attrib.get("lastClr"):
                val = "#" + sys_clr.attrib["lastClr"].lstrip("#")
            if val:
                colors[cname] = val
        colors["tx1"] = colors.get("dk1", colors["tx1"])
        colors["bg1"] = colors.get("lt1", colors["bg1"])
        colors["tx2"] = colors.get("dk2", colors["tx2"])
        colors["bg2"] = colors.get("lt2", colors["bg2"])
    except Exception:
        pass
    return colors


def _resolve_color_el(parent: Optional[ET.Element], theme_colors: Dict[str, str]) -> Optional[str]:
    if parent is None:
        return None
    srgb = parent.find(".//a:srgbClr", NS)
    if srgb is not None and srgb.attrib.get("val"):
        return "#" + srgb.attrib["val"].lstrip("#")
    scheme = parent.find(".//a:schemeClr", NS)
    if scheme is not None and scheme.attrib.get("val"):
        base = theme_colors.get(scheme.attrib["val"], "#111827")
        return base
    return None


def _extract_xfrm(el: Optional[ET.Element]) -> Optional[Tuple[float, float, float, float]]:
    if el is None:
        return None
    xfrm = el.find("p:spPr/a:xfrm", NS)
    if xfrm is None:
        xfrm = el.find("a:xfrm", NS)
    if xfrm is None:
        xfrm = el.find("p:xfrm", NS)
    if xfrm is None:
        xfrm = el.find(".//a:xfrm", NS)
    if xfrm is None:
        return None
    off = xfrm.find("a:off", NS)
    ext = xfrm.find("a:ext", NS)
    if off is None or ext is None:
        return None
    try:
        x = float(off.attrib.get("x", 0))
        y = float(off.attrib.get("y", 0))
        w = float(ext.attrib.get("cx", 0))
        h = float(ext.attrib.get("cy", 0))
        if w <= 0 or h <= 0:
            return None
        return (x, y, w, h)
    except (TypeError, ValueError):
        return None


def _collect_placeholders(zf: zipfile.ZipFile, xml_path: str) -> Dict[Tuple[str, str], Tuple[float, float, float, float]]:
    out: Dict[Tuple[str, str], Tuple[float, float, float, float]] = {}
    if xml_path not in zf.namelist():
        return out
    try:
        root = ET.fromstring(zf.read(xml_path))
        for sp in root.findall(".//p:sp", NS):
            ph = sp.find("p:nvSpPr/p:nvPr/p:ph", NS)
            if ph is None:
                continue
            xf = _extract_xfrm(sp)
            if not xf:
                continue
            ph_type = ph.attrib.get("type", "body")
            ph_idx = ph.attrib.get("idx", "")
            out[(ph_type, ph_idx)] = xf
            if (ph_type, "") not in out:
                out[(ph_type, "")] = xf
            if ("", ph_idx) not in out and ph_idx:
                out[("", ph_idx)] = xf
    except Exception:
        pass
    return out


def _extract_bg(
    root: ET.Element,
    rels: Dict[str, str],
    base_dir: str,
    theme_colors: Dict[str, str],
    valid_assets: set[str],
) -> Dict[str, Optional[str]]:
    bg = root.find("p:cSld/p:bg", NS)
    if bg is None:
        return {}
    bg_pr = bg.find("p:bgPr", NS)
    if bg_pr is not None:
        blip = bg_pr.find(".//a:blip", NS)
        if blip is not None:
            rid = blip.attrib.get(f"{{{NS['r']}}}embed")
            if rid and rid in rels:
                member = _safe_zip_member(base_dir, rels[rid])
                if member in valid_assets:
                    return {"bg_asset": member.removeprefix("ppt/")}
        solid = bg_pr.find("a:solidFill", NS)
        color = _resolve_color_el(solid, theme_colors)
        if color:
            return {"bg_color": color}
        grad = bg_pr.find("a:gradFill", NS)
        if grad is not None:
            stops = []
            for gs in grad.findall(".//a:gs", NS):
                c = _resolve_color_el(gs, theme_colors)
                if c:
                    stops.append(c)
            if len(stops) >= 2:
                return {"bg_color": stops[0], "bg_gradient": f"linear-gradient(135deg, {stops[0]} 0%, {stops[-1]} 100%)"}
            if stops:
                return {"bg_color": stops[0]}
    bg_ref = bg.find("p:bgRef", NS)
    if bg_ref is not None:
        color = _resolve_color_el(bg_ref, theme_colors)
        if color:
            return {"bg_color": color}
    return {}


def _extract_paragraphs(tx_body: Optional[ET.Element], theme_colors: Dict[str, str], scale_h: float = 1.0) -> List[Dict[str, Any]]:
    if tx_body is None:
        return []
    paragraphs: List[Dict[str, Any]] = []
    for p in tx_body.findall("a:p", NS):
        p_pr = p.find("a:pPr", NS)
        lvl = int(p_pr.attrib.get("lvl", 0)) if p_pr is not None and p_pr.attrib.get("lvl", "").isdigit() else 0
        algn_map = {"l": "left", "r": "right", "ctr": "center", "just": "justify"}
        align = algn_map.get(p_pr.attrib.get("algn", ""), "") if p_pr is not None else ""
        rtl_attr = p_pr.attrib.get("rtl") if p_pr is not None else None
        bullet = ""
        if p_pr is not None:
            if p_pr.find("a:buNone", NS) is None:
                bu_char = p_pr.find("a:buChar", NS)
                bu_num = p_pr.find("a:buAutoNum", NS)
                if bu_char is not None:
                    bullet = bu_char.attrib.get("char", "•")
                elif bu_num is not None:
                    bullet = "•"

        runs: List[Dict[str, Any]] = []
        raw_parts: List[str] = []
        for child in p:
            tag = _local_tag(child.tag)
            if tag == "br":
                runs.append({"text": "\n"})
                raw_parts.append("\n")
            elif tag in {"r", "fld"}:
                t_el = child.find("a:t", NS)
                txt = t_el.text if t_el is not None and t_el.text else ""
                if not txt:
                    continue
                raw_parts.append(txt)
                r_pr = child.find("a:rPr", NS)
                run_obj: Dict[str, Any] = {"text": txt}
                if r_pr is not None:
                    if r_pr.attrib.get("b") == "1":
                        run_obj["bold"] = True
                    if r_pr.attrib.get("i") == "1":
                        run_obj["italic"] = True
                    if r_pr.attrib.get("u") and r_pr.attrib.get("u") != "none":
                        run_obj["underline"] = True
                    sz = r_pr.attrib.get("sz")
                    if sz and sz.isdigit():
                        run_obj["size_pt"] = round((int(sz) / 100.0) * scale_h, 1)
                    fill_el = r_pr.find("a:solidFill", NS)
                    c = _resolve_color_el(fill_el, theme_colors)
                    if c:
                        run_obj["color"] = c
                runs.append(run_obj)

        full_text = "".join(raw_parts).strip()
        if not full_text:
            continue
        is_rtl = (rtl_attr in {"1", "true"}) or (_has_rtl_chars(full_text) and rtl_attr not in {"0", "false"})
        if not align:
            align = "right" if is_rtl else "left"
        paragraphs.append(
            {
                "rtl": is_rtl,
                "align": align,
                "lvl": lvl,
                "bullet": bullet,
                "runs": runs,
                "text": full_text,
            }
        )
    return paragraphs


def parse_pptx(raw_bytes: bytes, file_id: str = "") -> Dict[str, Any]:
    """Parse a PPTX file into proportional interactive slides with media & notes."""
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
        all_names = set(zf.namelist())
        theme_colors = _parse_theme_colors(zf)

        slide_cx = 12192000.0  # 16:9 default (13.333 in)
        slide_cy = 6858000.0   # 7.5 in
        slide_paths: List[str] = []

        if "ppt/presentation.xml" in all_names:
            pres_root = ET.fromstring(zf.read("ppt/presentation.xml"))
            sld_sz = pres_root.find("p:sldSz", NS)
            if sld_sz is not None:
                try:
                    cx = float(sld_sz.attrib.get("cx", slide_cx))
                    cy = float(sld_sz.attrib.get("cy", slide_cy))
                    if cx > 0 and cy > 0:
                        slide_cx, slide_cy = cx, cy
                except (TypeError, ValueError):
                    pass

            pres_rels = _parse_rels(zf, "ppt/_rels/presentation.xml.rels")
            sld_id_lst = pres_root.find("p:sldIdLst", NS)
            if sld_id_lst is not None:
                for sld_id in sld_id_lst.findall("p:sldId", NS):
                    rid = sld_id.attrib.get(f"{{{NS['r']}}}id")
                    if rid and rid in pres_rels:
                        p = _safe_zip_member("ppt", pres_rels[rid])
                        if p in all_names and p not in slide_paths:
                            slide_paths.append(p)

        if not slide_paths:
            def _slide_num_key(name: str) -> int:
                m = re.search(r"slide(\d+)\.xml$", name)
                return int(m.group(1)) if m else 999999
            slide_paths = sorted(
                (n for n in all_names if re.match(r"^ppt/slides/slide\d+\.xml$", n)),
                key=_slide_num_key,
            )

        valid_media = {n for n in all_names if n.startswith("ppt/media/")}
        layout_ph_cache: Dict[str, Dict[Tuple[str, str], Tuple[float, float, float, float]]] = {}
        layout_bg_cache: Dict[str, Dict[str, Optional[str]]] = {}

        def _get_layout_data(layout_path: str) -> Tuple[Dict[Tuple[str, str], Tuple[float, float, float, float]], Dict[str, Optional[str]]]:
            if layout_path in layout_ph_cache:
                return layout_ph_cache[layout_path], layout_bg_cache[layout_path]
            phs: Dict[Tuple[str, str], Tuple[float, float, float, float]] = {}
            bg_info: Dict[str, Optional[str]] = {}
            l_rels_path = posixpath.join(
                posixpath.dirname(layout_path), "_rels", posixpath.basename(layout_path) + ".rels"
            )
            l_rels = _parse_rels(zf, l_rels_path)
            for t in l_rels.values():
                if "slideMaster" in t:
                    master_path = _safe_zip_member(posixpath.dirname(layout_path), t)
                    phs.update(_collect_placeholders(zf, master_path))
                    if master_path in all_names:
                        m_root = ET.fromstring(zf.read(master_path))
                        m_rels = _parse_rels(
                            zf,
                            posixpath.join(posixpath.dirname(master_path), "_rels", posixpath.basename(master_path) + ".rels"),
                        )
                        bg_info.update(_extract_bg(m_root, m_rels, posixpath.dirname(master_path), theme_colors, valid_media))
            phs.update(_collect_placeholders(zf, layout_path))
            if layout_path in all_names:
                l_root = ET.fromstring(zf.read(layout_path))
                bg_info.update(_extract_bg(l_root, l_rels, posixpath.dirname(layout_path), theme_colors, valid_media))
            layout_ph_cache[layout_path] = phs
            layout_bg_cache[layout_path] = bg_info
            return phs, bg_info

        slides: List[Dict[str, Any]] = []
        assets: set[str] = set()

        for idx, spath in enumerate(slide_paths, start=1):
            s_root = ET.fromstring(zf.read(spath))
            s_dir = posixpath.dirname(spath)
            s_rels = _parse_rels(zf, posixpath.join(s_dir, "_rels", posixpath.basename(spath) + ".rels"))

            phs: Dict[Tuple[str, str], Tuple[float, float, float, float]] = {}
            bg_info: Dict[str, Optional[str]] = {}
            notes_lines: List[str] = []

            for target in s_rels.values():
                if "slideLayout" in target:
                    l_path = _safe_zip_member(s_dir, target)
                    l_phs, l_bg = _get_layout_data(l_path)
                    phs.update(l_phs)
                    bg_info.update(l_bg)
                elif "notesSlide" in target:
                    n_path = _safe_zip_member(s_dir, target)
                    if n_path in all_names:
                        try:
                            n_root = ET.fromstring(zf.read(n_path))
                            for sp in n_root.findall(".//p:sp", NS):
                                ph = sp.find("p:nvSpPr/p:nvPr/p:ph", NS)
                                if ph is not None and ph.attrib.get("type") in {"sldImg", "sldNum"}:
                                    continue
                                for p_el in sp.findall(".//a:p", NS):
                                    t = "".join(t.text or "" for t in p_el.findall(".//a:t", NS)).strip()
                                    if t:
                                        notes_lines.append(t)
                        except Exception:
                            pass

            bg_info.update(_extract_bg(s_root, s_rels, s_dir, theme_colors, valid_media))
            if bg_info.get("bg_asset"):
                assets.add(str(bg_info["bg_asset"]))

            elements: List[Dict[str, Any]] = []
            sp_tree = s_root.find("p:cSld/p:spTree", NS)

            def _to_pct(box: Tuple[float, float, float, float], xform_ctx: Tuple[float, float, float, float]) -> Dict[str, float]:
                ox, oy, ow, oh = xform_ctx
                bx, by, bw, bh = box
                return {
                    "x": round(max(0.0, min(100.0, (bx * ow + ox) / slide_cx * 100.0)), 2),
                    "y": round(max(0.0, min(100.0, (by * oh + oy) / slide_cy * 100.0)), 2),
                    "w": round(max(1.0, min(100.0, (bw * ow) / slide_cx * 100.0)), 2),
                    "h": round(max(1.0, min(100.0, (bh * oh) / slide_cy * 100.0)), 2),
                }

            def _walk_tree(node: ET.Element, ctx: Tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0)) -> None:
                for child in node:
                    tag = _local_tag(child.tag)
                    if tag == "grpSp":
                        g_xf = child.find("p:grpSpPr/a:xfrm", NS)
                        new_ctx = ctx
                        if g_xf is not None:
                            off = g_xf.find("a:off", NS)
                            ext = g_xf.find("a:ext", NS)
                            ch_off = g_xf.find("a:chOff", NS)
                            ch_ext = g_xf.find("a:chExt", NS)
                            if off is not None and ext is not None and ch_off is not None and ch_ext is not None:
                                try:
                                    gx, gy = float(off.attrib.get("x", 0)), float(off.attrib.get("y", 0))
                                    gw, gh = float(ext.attrib.get("cx", 1)), float(ext.attrib.get("cy", 1))
                                    cx0, cy0 = float(ch_off.attrib.get("x", 0)), float(ch_off.attrib.get("y", 0))
                                    cw0, ch0 = float(ch_ext.attrib.get("cx", 1)) or 1.0, float(ch_ext.attrib.get("cy", 1)) or 1.0
                                    sx = (gw / cw0) * ctx[2]
                                    sy = (gh / ch0) * ctx[3]
                                    nx = ctx[0] + gx * ctx[2] - cx0 * sx
                                    ny = ctx[1] + gy * ctx[3] - cy0 * sy
                                    new_ctx = (nx, ny, sx, sy)
                                except Exception:
                                    pass
                        _walk_tree(child, new_ctx)
                        continue

                    if tag == "sp":
                        xf = _extract_xfrm(child)
                        ph = child.find("p:nvSpPr/p:nvPr/p:ph", NS)
                        ph_type = ph.attrib.get("type", "body") if ph is not None else ""
                        ph_idx = ph.attrib.get("idx", "") if ph is not None else ""
                        if xf is None and ph is not None:
                            xf = (
                                phs.get((ph_type, ph_idx))
                                or phs.get((ph_type, ""))
                                or phs.get(("", ph_idx))
                            )
                        paras = _extract_paragraphs(child.find("p:txBody", NS), theme_colors)
                        sp_pr = child.find("p:spPr", NS)
                        fill = _resolve_color_el(sp_pr.find("a:solidFill", NS), theme_colors) if sp_pr is not None else None
                        stroke = _resolve_color_el(sp_pr.find("a:ln/a:solidFill", NS), theme_colors) if sp_pr is not None else None
                        if not paras and not fill and not stroke:
                            continue
                        if xf is None:
                            # Reasonable fallback box when placeholder was omitted from layout
                            if ph_type in {"title", "ctrTitle"}:
                                xf = (slide_cx * 0.06, slide_cy * 0.06, slide_cx * 0.88, slide_cy * 0.16)
                            elif ph_type == "subTitle":
                                xf = (slide_cx * 0.10, slide_cy * 0.25, slide_cx * 0.80, slide_cy * 0.16)
                            elif ph_type == "sldNum":
                                continue
                            else:
                                xf = (slide_cx * 0.06, slide_cy * 0.24, slide_cx * 0.88, slide_cy * 0.68)
                        geom = sp_pr.find("a:prstGeom", NS) if sp_pr is not None else None
                        shape_kind = geom.attrib.get("prst", "rect") if geom is not None else "rect"
                        elements.append(
                            {
                                "type": "shape",
                                **_to_pct(xf, ctx),
                                "shape": shape_kind,
                                "fill": fill,
                                "stroke": stroke,
                                "is_title": ph_type in {"title", "ctrTitle"},
                                "paragraphs": paras,
                            }
                        )
                        continue

                    if tag == "pic":
                        xf = _extract_xfrm(child)
                        blip = child.find(".//a:blip", NS)
                        if xf is None or blip is None:
                            continue
                        rid = blip.attrib.get(f"{{{NS['r']}}}embed")
                        if not rid or rid not in s_rels:
                            continue
                        member = _safe_zip_member(s_dir, s_rels[rid])
                        if member not in valid_media:
                            continue
                        ext = member.rsplit(".", 1)[-1].lower() if "." in member else ""
                        asset_rel = member.removeprefix("ppt/")
                        if ext in _BROWSER_IMAGE_EXTS:
                            assets.add(asset_rel)
                        elements.append(
                            {
                                "type": "image",
                                **_to_pct(xf, ctx),
                                "asset": asset_rel,
                                "supported": ext in _BROWSER_IMAGE_EXTS,
                                "ext": ext,
                            }
                        )
                        continue

                    if tag == "graphicFrame":
                        tbl = child.find(".//a:tbl", NS)
                        xf = _extract_xfrm(child)
                        if tbl is None or xf is None:
                            continue
                        rows: List[List[Dict[str, Any]]] = []
                        for tr in tbl.findall("a:tr", NS):
                            row_cells: List[Dict[str, Any]] = []
                            for tc in tr.findall("a:tc", NS):
                                tc_pr = tc.find("a:tcPr", NS)
                                c_fill = _resolve_color_el(tc_pr.find("a:solidFill", NS), theme_colors) if tc_pr is not None else None
                                c_paras = _extract_paragraphs(tc.find("a:txBody", NS), theme_colors)
                                cell_text = "\n".join(p["text"] for p in c_paras)
                                row_cells.append(
                                    {
                                        "text": cell_text,
                                        "fill": c_fill,
                                        "rtl": any(p["rtl"] for p in c_paras) or _has_rtl_chars(cell_text),
                                    }
                                )
                            if row_cells:
                                rows.append(row_cells)
                        if rows:
                            elements.append(
                                {
                                    "type": "table",
                                    **_to_pct(xf, ctx),
                                    "rows": rows,
                                }
                            )

            if sp_tree is not None:
                _walk_tree(sp_tree)

            title_text = ""
            for el in elements:
                if el.get("is_title") and el.get("paragraphs"):
                    title_text = " ".join(p["text"] for p in el["paragraphs"]).strip()
                    break
            if not title_text:
                for el in elements:
                    if el.get("paragraphs"):
                        title_text = el["paragraphs"][0]["text"][:80]
                        break

            slides.append(
                {
                    "index": idx,
                    "title": title_text or f"اسلاید {idx}",
                    "bg_color": bg_info.get("bg_color") or "#FFFFFF",
                    "bg_gradient": bg_info.get("bg_gradient"),
                    "bg_asset": bg_info.get("bg_asset"),
                    "elements": elements,
                    "notes": "\n".join(notes_lines).strip(),
                }
            )

        return {
            "kind": "slides",
            "format": "pptx",
            "file_id": file_id,
            "aspect_ratio": round(slide_cx / slide_cy, 4) if slide_cy else 1.7778,
            "total_slides": len(slides),
            "slides": slides,
            "assets": sorted(assets),
        }


def get_office_asset(raw_bytes: bytes, asset_path: str) -> Optional[Tuple[bytes, str]]:
    """Safely extract an image asset inside a PPTX/DOCX ZIP archive."""
    clean = (asset_path or "").replace("\\", "/").lstrip("/")
    if not clean or ".." in clean or "\0" in clean:
        return None
    candidates = [clean, f"ppt/{clean}", f"word/{clean}"]
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
        names = set(zf.namelist())
        for cand in candidates:
            if cand in names and (cand.startswith("ppt/media/") or cand.startswith("word/media/")):
                ext = cand.rsplit(".", 1)[-1].lower() if "." in cand else ""
                mime = _IMAGE_MIMES.get(ext, "application/octet-stream")
                return zf.read(cand), mime
    return None


def parse_docx(raw_bytes: bytes, file_id: str = "") -> Dict[str, Any]:
    """Parse a DOCX file into structured blocks (headings, paragraphs, lists, tables, images)."""
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
        all_names = set(zf.namelist())
        if "word/document.xml" not in all_names:
            raise ValueError("invalid_docx")
        doc_root = ET.fromstring(zf.read("word/document.xml"))
        rels = _parse_rels(zf, "word/_rels/document.xml.rels")
        valid_media = {n for n in all_names if n.startswith("word/media/")}

        body = doc_root.find("w:body", NS)
        blocks: List[Dict[str, Any]] = []
        assets: set[str] = set()
        stats = {"paragraphs": 0, "tables": 0, "images": 0}

        if body is not None:
            for child in body:
                tag = _local_tag(child.tag)
                if tag == "p":
                    p_pr = child.find("w:pPr", NS)
                    style_el = p_pr.find("w:pStyle", NS) if p_pr is not None else None
                    style_val = style_el.attrib.get(f"{{{NS['w']}}}val", "") if style_el is not None else ""
                    num_pr = p_pr.find("w:numPr", NS) if p_pr is not None else None
                    bidi_el = p_pr.find("w:bidi", NS) if p_pr is not None else None
                    jc_el = p_pr.find("w:jc", NS) if p_pr is not None else None
                    jc_val = jc_el.attrib.get(f"{{{NS['w']}}}val", "") if jc_el is not None else ""

                    heading = 0
                    sl = style_val.lower()
                    if sl == "title":
                        heading = 1
                    elif sl == "subtitle":
                        heading = 2
                    else:
                        m_h = re.match(r"heading\s*([1-6])", sl)
                        if m_h:
                            heading = int(m_h.group(1))

                    # Inline drawings / images inside paragraph
                    for blip in child.findall(".//a:blip", NS):
                        rid = blip.attrib.get(f"{{{NS['r']}}}embed")
                        if rid and rid in rels:
                            member = _safe_zip_member("word", rels[rid])
                            if member in valid_media:
                                ext = member.rsplit(".", 1)[-1].lower() if "." in member else ""
                                if ext in _BROWSER_IMAGE_EXTS:
                                    rel_asset = member.removeprefix("word/")
                                    assets.add(rel_asset)
                                    stats["images"] += 1
                                    blocks.append({"type": "image", "asset": rel_asset})

                    runs: List[Dict[str, Any]] = []
                    parts: List[str] = []
                    for r in child.findall(".//w:r", NS):
                        r_pr = r.find("w:rPr", NS)
                        t_parts = []
                        for sub in r:
                            stag = _local_tag(sub.tag)
                            if stag == "t" and sub.text:
                                t_parts.append(sub.text)
                            elif stag == "tab":
                                t_parts.append("    ")
                            elif stag == "br":
                                t_parts.append("\n")
                        txt = "".join(t_parts)
                        if not txt:
                            continue
                        parts.append(txt)
                        robj: Dict[str, Any] = {"text": txt}
                        if r_pr is not None:
                            if r_pr.find("w:b", NS) is not None:
                                robj["bold"] = True
                            if r_pr.find("w:i", NS) is not None:
                                robj["italic"] = True
                            if r_pr.find("w:u", NS) is not None:
                                robj["underline"] = True
                            c_el = r_pr.find("w:color", NS)
                            if c_el is not None:
                                val = c_el.attrib.get(f"{{{NS['w']}}}val", "")
                                if val and val.lower() != "auto" and re.match(r"^[0-9a-fA-F]{6}$", val):
                                    robj["color"] = "#" + val
                        runs.append(robj)

                    full_text = "".join(parts).strip()
                    if not full_text:
                        continue
                    stats["paragraphs"] += 1
                    is_rtl = (bidi_el is not None) or _has_rtl_chars(full_text)
                    align_map = {"left": "left", "right": "right", "center": "center", "both": "justify", "start": "right" if is_rtl else "left", "end": "left" if is_rtl else "right"}
                    blocks.append(
                        {
                            "type": "heading" if heading else ("list_item" if num_pr is not None else "paragraph"),
                            "level": heading or (1 if num_pr is not None else 0),
                            "rtl": is_rtl,
                            "align": align_map.get(jc_val, "right" if is_rtl else "left"),
                            "text": full_text,
                            "runs": runs,
                        }
                    )

                elif tag == "tbl":
                    rows: List[List[Dict[str, Any]]] = []
                    for tr in child.findall("w:tr", NS):
                        row_cells: List[Dict[str, Any]] = []
                        for tc in tr.findall("w:tc", NS):
                            cell_lines: List[str] = []
                            for cp in tc.findall(".//w:p", NS):
                                ct = "".join(t.text or "" for t in cp.findall(".//w:t", NS)).strip()
                                if ct:
                                    cell_lines.append(ct)
                            ctext = "\n".join(cell_lines)
                            row_cells.append({"text": ctext, "rtl": _has_rtl_chars(ctext)})
                        if row_cells:
                            rows.append(row_cells)
                    if rows:
                        stats["tables"] += 1
                        blocks.append({"type": "table", "rows": rows})

        return {
            "kind": "document",
            "format": "docx",
            "file_id": file_id,
            "blocks": blocks,
            "assets": sorted(assets),
            "stats": stats,
        }


def parse_xlsx(raw_bytes: bytes, file_id: str = "", max_sheets: int = 16, max_rows: int = 800, max_cols: int = 40) -> Dict[str, Any]:
    """Parse an XLSX workbook into sheet tables."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
    try:
        sheets: List[Dict[str, Any]] = []
        for sheet_name in wb.sheetnames[:max_sheets]:
            ws = wb[sheet_name]
            rows: List[List[str]] = []
            truncated = False
            for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                if r_idx > max_rows:
                    truncated = True
                    break
                cells = ["" if v is None else str(v) for v in row[:max_cols]]
                # Trim trailing empty cells on long sparse rows
                while cells and cells[-1] == "":
                    cells.pop()
                if cells or len(rows) < 50:
                    rows.append(cells)
            # Strip trailing empty rows
            while rows and not rows[-1]:
                rows.pop()
            sheets.append(
                {
                    "name": sheet_name,
                    "rows": rows,
                    "truncated": truncated,
                }
            )
        return {
            "kind": "sheet",
            "format": "xlsx",
            "file_id": file_id,
            "sheets": sheets,
        }
    finally:
        wb.close()


def parse_csv_sheet(raw_bytes: bytes, file_id: str = "", delimiter: str = ",", max_rows: int = 1000) -> Dict[str, Any]:
    text = _decode_text(raw_bytes)
    rows: List[List[str]] = []
    truncated = False
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    for idx, row in enumerate(reader, start=1):
        if idx > max_rows:
            truncated = True
            break
        rows.append([str(c) for c in row[:40]])
    return {
        "kind": "sheet",
        "format": "tsv" if delimiter == "\t" else "csv",
        "file_id": file_id,
        "sheets": [{"name": "جدول", "rows": rows, "truncated": truncated}],
    }


def parse_text_document(raw_bytes: bytes, file_id: str = "", fmt: str = "txt") -> Dict[str, Any]:
    max_bytes = 512 * 1024
    truncated = len(raw_bytes) > max_bytes
    text = _decode_text(raw_bytes[:max_bytes])
    return {
        "kind": "document",
        "format": fmt,
        "file_id": file_id,
        "text": text,
        "rtl": _has_rtl_chars(text[:2000]),
        "truncated": truncated,
    }


def parse_zip_archive(raw_bytes: bytes, file_id: str = "") -> Dict[str, Any]:
    entries: List[Dict[str, Any]] = []
    total_uncompressed = 0
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
        for info in zf.infolist()[:400]:
            # Fix legacy ZIP non-UTF8 encoding gracefully if needed
            fname = info.filename
            if not (info.flag_bits & 0x800):
                try:
                    fname = fname.encode("cp437").decode("utf-8")
                except Exception:
                    try:
                        fname = fname.encode("cp437").decode("cp1256")
                    except Exception:
                        pass
            is_dir = info.is_dir() or fname.endswith("/")
            ext = fname.rsplit(".", 1)[-1].lower() if "." in fname and not is_dir else ""
            total_uncompressed += int(info.file_size or 0)
            entries.append(
                {
                    "name": fname,
                    "size": int(info.file_size or 0),
                    "compressed_size": int(info.compress_size or 0),
                    "is_dir": is_dir,
                    "ext": ext,
                }
            )
    return {
        "kind": "archive",
        "format": "zip",
        "file_id": file_id,
        "entries": entries,
        "total_entries": len(entries),
        "total_size": total_uncompressed,
    }


def parse_legacy_ole_text(raw_bytes: bytes, file_id: str = "", fmt: str = "ppt") -> Dict[str, Any]:
    """Best-effort clean text extractor for legacy binary .ppt / .doc / .xls files."""
    chunks: List[str] = []
    seen: set[str] = set()
    # Extract UTF-16LE sequences common in OLE Office binary records
    try:
        u16 = raw_bytes[: 4 * 1024 * 1024].decode("utf-16le", errors="ignore")
        for m in _PRINTABLE_CHUNK_RE.finditer(u16):
            s = re.sub(r"\s+", " ", m.group(0)).strip()
            if len(s) >= 6 and s not in seen and not s.startswith(("Root Entry", "PowerPoint Document", "WordDocument")):
                seen.add(s)
                chunks.append(s)
            if len(chunks) >= 250:
                break
    except Exception:
        pass
    # Fallback UTF-8 / ASCII chunks if minimal UTF-16 found
    if len(chunks) < 10:
        try:
            s8 = raw_bytes[: 2 * 1024 * 1024].decode("utf-8", errors="ignore")
            for m in _PRINTABLE_CHUNK_RE.finditer(s8):
                s = re.sub(r"\s+", " ", m.group(0)).strip()
                if len(s) >= 6 and s not in seen:
                    seen.add(s)
                    chunks.append(s)
                if len(chunks) >= 250:
                    break
        except Exception:
            pass

    if fmt in {"ppt", "pps"}:
        # Group into readable slide cards so SlidesView shows structured content
        slides: List[Dict[str, Any]] = []
        chunk_size = 8
        for i in range(0, max(1, len(chunks)), chunk_size):
            batch = chunks[i : i + chunk_size]
            if not batch:
                continue
            title = batch[0][:90]
            paras = [
                {
                    "rtl": _has_rtl_chars(line),
                    "align": "right" if _has_rtl_chars(line) else "left",
                    "lvl": 0,
                    "bullet": "•" if j > 0 else "",
                    "runs": [{"text": line, "bold": j == 0}],
                    "text": line,
                }
                for j, line in enumerate(batch)
            ]
            slides.append(
                {
                    "index": len(slides) + 1,
                    "title": title,
                    "bg_color": "#FFFFFF",
                    "elements": [
                        {
                            "type": "shape",
                            "x": 6.0,
                            "y": 10.0,
                            "w": 88.0,
                            "h": 80.0,
                            "shape": "rect",
                            "paragraphs": paras,
                        }
                    ],
                    "notes": "",
                }
            )
        return {
            "kind": "slides",
            "format": "ppt",
            "file_id": file_id,
            "aspect_ratio": 1.3333,
            "total_slides": len(slides),
            "slides": slides,
            "assets": [],
            "is_legacy_binary": True,
        }

    text = "\n\n".join(chunks)
    return {
        "kind": "document",
        "format": fmt,
        "file_id": file_id,
        "text": text,
        "rtl": _has_rtl_chars(text[:2000]),
        "is_legacy_binary": True,
    }


def parse_office_or_attachment(
    raw_bytes: bytes,
    file_id: str,
    mime: str = "",
    ext: str = "",
    name: str = "",
) -> Dict[str, Any]:
    """Unified entry point returning viewer-ready JSON payload for non-media files."""
    if not ext and "." in (name or ""):
        ext = name.rsplit(".", 1)[-1].lower()
    fmt = sniff_format_from_bytes(raw_bytes, ext=ext, mime=mime)

    if fmt == "pptx":
        return parse_pptx(raw_bytes, file_id=file_id)
    if fmt == "docx":
        return parse_docx(raw_bytes, file_id=file_id)
    if fmt == "xlsx":
        return parse_xlsx(raw_bytes, file_id=file_id)
    if fmt in {"csv", "tsv"}:
        return parse_csv_sheet(raw_bytes, file_id=file_id, delimiter="\t" if fmt == "tsv" else ",")
    if fmt in {"txt", "md", "markdown", "json", "xml", "html", "htm", "log"}:
        return parse_text_document(raw_bytes, file_id=file_id, fmt=fmt)
    if fmt == "zip":
        return parse_zip_archive(raw_bytes, file_id=file_id)
    if fmt in {"ppt", "pps", "doc", "xls"}:
        return parse_legacy_ole_text(raw_bytes, file_id=file_id, fmt=fmt)

    return {
        "kind": "attachment",
        "format": fmt,
        "file_id": file_id,
        "size": len(raw_bytes),
        "name": name,
        "mime": mime,
    }
