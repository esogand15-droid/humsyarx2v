# -*- coding: utf-8 -*-
"""Regression & parity tests for Web Student universal reader, Office/Slides engine,
auth cookie parity, schedule PDF export, web PDF quiz, web lecture scribe, and profile code regen.
"""
from __future__ import annotations

import base64
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import zipfile

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.auth import get_current_user, require_feature
from backend.api.routers import web_reader
from backend.api.routers.web_student import current_student
from backend.services.office_viewer import (
    detect_web_kind,
    get_office_asset,
    parse_csv_sheet,
    parse_docx,
    parse_legacy_ole_text,
    parse_office_or_attachment,
    parse_pptx,
    parse_text_document,
    parse_xlsx,
    parse_zip_archive,
    sniff_format_from_bytes,
)


_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _build_sample_pptx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Default Extension="png" ContentType="image/png"/>'
            "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "ppt/presentation.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>'
            '<p:sldSz cx="12192000" cy="6858000"/>'
            "</p:presentation>",
        )
        zf.writestr(
            "ppt/_rels/presentation.xml.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "ppt/slides/slide1.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            "<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>"
            "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr>"
            "<p:spPr><a:xfrm><a:off x=\"600000\" y=\"400000\"/><a:ext cx=\"8000000\" cy=\"1000000\"/></a:xfrm></p:spPr>"
            "<p:txBody><a:bodyPr/><a:p><a:pPr rtl=\"1\"/><a:r><a:rPr b=\"1\"/><a:t>آناتومی قلب</a:t></a:r></a:p></p:txBody></p:sp>"
            "<p:pic><p:nvPicPr><p:cNvPr id=\"3\" name=\"Img\"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>"
            "<p:blipFill><a:blip r:embed=\"rIdImage1\"/></p:blipFill>"
            "<p:spPr><a:xfrm><a:off x=\"600000\" y=\"2000000\"/><a:ext cx=\"2000000\" cy=\"2000000\"/></a:xfrm></p:spPr></p:pic>"
            "</p:spTree></p:cSld></p:sld>",
        )
        zf.writestr(
            "ppt/slides/_rels/slide1.xml.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>'
            '<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "ppt/notesSlides/notesSlide1.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            "<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>نکته استاد: دریچه میترال دو لختی است</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>"
            "</p:notes>",
        )
        zf.writestr("ppt/media/image1.png", _PNG_1X1)
    return buf.getvalue()


def _build_sample_docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body>"
            '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>فصل اول: فیزیولوژی</w:t></w:r></w:p>'
            "<w:p><w:r><w:t>برون‌ده قلبی برابر است با حجم ضربه‌ای ضربدر ضربان قلب.</w:t></w:r></w:p>"
            "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>پارامتر</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>مقدار</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
            "</w:body></w:document>",
        )
    return buf.getvalue()


def _build_sample_xlsx() -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "نمرات"
    ws.append(["درس", "نمره"])
    ws.append(["آناتومی", 19.5])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


class OfficeViewerTests(unittest.TestCase):
    def test_detect_and_sniff_formats(self):
        self.assertEqual(detect_web_kind(ext="pptx"), "slides")
        self.assertEqual(detect_web_kind(ext="docx"), "document")
        self.assertEqual(detect_web_kind(ext="xlsx"), "sheet")
        self.assertEqual(detect_web_kind(ext="zip"), "archive")
        self.assertEqual(sniff_format_from_bytes(b"%PDF-1.7 ..."), "pdf")
        self.assertEqual(sniff_format_from_bytes(_build_sample_pptx()), "pptx")
        self.assertEqual(sniff_format_from_bytes(_build_sample_docx()), "docx")

    def test_pptx_slides_notes_and_asset_extraction(self):
        raw = _build_sample_pptx()
        parsed = parse_office_or_attachment(raw, file_id="slide_1", ext="pptx", name="heart.pptx")
        self.assertEqual(parsed["kind"], "slides")
        self.assertEqual(parsed["format"], "pptx")
        self.assertEqual(parsed["total_slides"], 1)
        slide = parsed["slides"][0]
        self.assertIn("آناتومی قلب", slide["title"])
        self.assertIn("دریچه میترال", slide["notes"])
        self.assertTrue(any(el.get("type") == "image" for el in slide["elements"]))
        self.assertIn("media/image1.png", parsed["assets"])

        extracted = get_office_asset(raw, "media/image1.png")
        self.assertIsNotNone(extracted)
        assert extracted is not None
        self.assertEqual(extracted[1], "image/png")
        self.assertEqual(extracted[0], _PNG_1X1)
        self.assertIsNotNone(get_office_asset(raw, "ppt/media/image1.png"))
        # Path traversal guard
        self.assertIsNone(get_office_asset(raw, "../etc/passwd"))

    def test_docx_xlsx_csv_txt_zip_ole(self):
        doc_res = parse_docx(_build_sample_docx(), file_id="d1")
        self.assertEqual(doc_res["kind"], "document")
        self.assertTrue(any(b.get("type") == "heading" for b in doc_res["blocks"]))
        self.assertTrue(any(b.get("type") == "table" for b in doc_res["blocks"]))

        xls_res = parse_xlsx(_build_sample_xlsx(), file_id="x1")
        self.assertEqual(xls_res["kind"], "sheet")
        self.assertEqual(xls_res["sheets"][0]["name"], "نمرات")
        self.assertEqual(xls_res["sheets"][0]["rows"][1][0], "آناتومی")

        csv_res = parse_csv_sheet("نام,نمره\nعلی,۲۰".encode("utf-8"), file_id="c1")
        self.assertEqual(csv_res["kind"], "sheet")
        self.assertEqual(csv_res["sheets"][0]["rows"][0], ["نام", "نمره"])

        txt_res = parse_text_document("سلام دنیا\nمتن تستی".encode("utf-8"), file_id="t1", fmt="md")
        self.assertEqual(txt_res["kind"], "document")
        self.assertTrue(txt_res["rtl"])

        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w") as zf:
            zf.writestr("lecture/note.pdf", b"%PDF-1.4")
        zip_res = parse_zip_archive(zbuf.getvalue(), file_id="z1")
        self.assertEqual(zip_res["kind"], "archive")
        self.assertEqual(zip_res["total_entries"], 1)

        ole_raw = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" + "نکته مهم بافت‌شناسی قلب".encode("utf-16le")
        ole_res = parse_legacy_ole_text(ole_raw, file_id="p1", fmt="ppt")
        self.assertEqual(ole_res["kind"], "slides")
        self.assertTrue(ole_res["is_legacy_binary"])


class WebReaderAndAuthParityTests(unittest.TestCase):
    def setUp(self):
        self._prev_overrides = dict(app.dependency_overrides)

    def tearDown(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self._prev_overrides)
        web_reader._OFFICE_PARSED_CACHE.clear()

    def test_view_url_office_asset_and_download(self):
        sample_pptx = _build_sample_pptx()
        fake_user = {
            "user_id": 77,
            "id": 77,
            "name": "سارا رضایی",
            "approved": True,
            "intake": "mehr_1403",
            "group": "1",
        }
        fake_item = {
            "_id": "res_pptx_1",
            "session_id": "sess_1",
            "file_name": "anatomy.pptx",
            "title": "آناتومی قلب",
            "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "file_size": len(sample_pptx),
            "raw_bytes": sample_pptx,
        }

        async def _fake_student():
            return fake_user

        app.dependency_overrides[current_student] = _fake_student
        client = TestClient(app)

        with (
            patch.object(web_reader, "_gate", AsyncMock(return_value=None)),
            patch.object(web_reader, "_item", AsyncMock(return_value=fake_item)),
            patch.object(web_reader, "_guard_and_resolve_item", AsyncMock(return_value=fake_item)),
            patch.object(web_reader.db, "get_setting", AsyncMock(return_value=False)),
            patch.object(web_reader.db, "get_user", AsyncMock(return_value=fake_user)),
            patch.object(web_reader.db, "bs_inc_download", AsyncMock(return_value=None)),
        ):
            r_view = client.get("/api/web/library/view-url/res/res_pptx_1")
            self.assertEqual(r_view.status_code, 200)
            vdata = r_view.json()
            self.assertTrue(vdata["available"])
            self.assertEqual(vdata["kind"], "slides")
            self.assertEqual(vdata["url"], "/api/web/reader/office/res/res_pptx_1")
            self.assertTrue(vdata["allow_download"])
            self.assertTrue(vdata["download_url"])

            r_office = client.get("/api/web/reader/office/res/res_pptx_1")
            self.assertEqual(r_office.status_code, 200)
            odata = r_office.json()
            self.assertEqual(odata["kind"], "slides")
            self.assertEqual(odata["total_slides"], 1)
            asset_url = odata["asset_urls"]["media/image1.png"]

            r_asset = client.get(asset_url)
            self.assertEqual(r_asset.status_code, 200)
            self.assertEqual(r_asset.headers["content-type"], "image/png")
            self.assertEqual(r_asset.content, _PNG_1X1)

            bad_asset = client.get(asset_url.replace("token=", "token=00000000"))
            self.assertEqual(bad_asset.status_code, 403)

            r_dl = client.get(vdata["download_url"])
            self.assertEqual(r_dl.status_code, 200)
            self.assertIn("attachment;", r_dl.headers.get("content-disposition", ""))
            self.assertEqual(r_dl.content, sample_pptx)

    def test_auth_accepts_hy_student_session_cookie(self):
        from backend.api import auth
        from backend.api.routers import profile as prof_router

        fake_sess = {"_id": "hash", "uid": 88, "revoked": False}
        fake_db_user = {"user_id": 88, "id": 88, "name": "علی", "approved": True}
        client = TestClient(app)

        with (
            patch.object(auth, "resolve_web_user_session", AsyncMock(return_value=None)),
            patch.object(auth, "resolve_student_legacy_session", AsyncMock(return_value=fake_sess)),
            patch.object(auth.db, "get_user", AsyncMock(return_value=fake_db_user)),
            patch.object(prof_router.db, "get_setting", AsyncMock(return_value=False)),
        ):
            client.cookies.set(auth.STUDENT_LEGACY_COOKIE, "tok_123")
            r = client.get("/api/profile/donation")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json(), {"enabled": False, "link": ""})

    def test_schedule_pdf_quiz_lecture_and_profile_regen(self):
        fake_user = {"id": 55, "user_id": 55, "_db": {"user_id": 55, "name": "نگار محمدی", "group": "1", "approved": True}}

        async def _fake_user():
            return fake_user

        app.dependency_overrides[get_current_user] = _fake_user
        app.dependency_overrides[require_feature("ai_practice")] = _fake_user
        app.dependency_overrides[require_feature("ai_chat")] = _fake_user
        client = TestClient(app)

        # 1) Schedule PDF export
        from backend.api.routers import schedule as sched_router
        fake_sched = {"items": [{"title": "آناتومی عمومی", "day": "شنبه", "time": "08:00-10:00", "location": "تالار ۱"}], "computed_group": "1"}
        with patch.object(sched_router.db, "get_personalized_schedules", AsyncMock(return_value=fake_sched)):
            r_pdf = client.get("/api/web/schedule/pdf")
            self.assertEqual(r_pdf.status_code, 200)
            self.assertEqual(r_pdf.headers["content-type"], "application/pdf")
            self.assertTrue(r_pdf.content.startswith(b"%PDF"))

        # 2) Web Quiz config
        from backend.api.routers import web_quiz
        quiz_settings = {
            "quiz_pdf_enabled": True,
            "quiz_max_pdf_mb": 20,
            "quiz_max_pages": 120,
            "quiz_max_questions_per_session": 20,
            "quiz_daily_question_limit": 20,
        }
        with (
            patch.object(web_quiz.hooshyar_quiz, "_setting", AsyncMock(side_effect=lambda k: quiz_settings[k])),
            patch.object(web_quiz.db, "quiz_usage_today", AsyncMock(return_value=3)),
        ):
            r_qcfg = client.get("/api/web/quiz/config")
            self.assertEqual(r_qcfg.status_code, 200)
            self.assertEqual(r_qcfg.json()["remaining_today"], 17)
            self.assertEqual(r_qcfg.json()["max_questions_per_session"], 20)

        # 3) Profile web_login_code regeneration
        from backend.api.routers import profile as prof_router
        with (
            patch.object(prof_router.db.users, "find_one", AsyncMock(return_value=None)),
            patch.object(prof_router.db.users, "update_one", AsyncMock(return_value=None)),
        ):
            r_regen = client.post("/api/profile/web-code/regenerate", json={})
            self.assertEqual(r_regen.status_code, 200)
            code = r_regen.json()["web_login_code"]
            self.assertTrue(code.startswith("HY-"))
            self.assertEqual(len(code), 12)  # HY-XXXX-XXXX

        # 4) Web Lecture PDF serving from LocalStorageDriver
        from backend.api.routers import web_lecture
        fake_storage = MagicMock()
        fake_storage.get_original = AsyncMock(return_value=b"%PDF-1.4\n%test")
        fake_coll = MagicMock()
        fake_coll.find_one = AsyncMock(return_value={"_id": "job_1", "user_id": 55, "title": "جزوه تستی", "pdf_ready": True})
        with (
            patch.object(web_lecture, "_coll", return_value=fake_coll),
            patch.object(web_lecture, "get_storage_driver", return_value=fake_storage),
        ):
            r_lpdf = client.get("/api/web/lecture/jobs/job_1/pdf")
            self.assertEqual(r_lpdf.status_code, 200)
            self.assertEqual(r_lpdf.headers["content-type"], "application/pdf")
            self.assertTrue(r_lpdf.content.startswith(b"%PDF"))


class StudentAppNoBotBlockersTests(unittest.TestCase):
    def test_no_legacy_bot_only_restrictions_in_student_src(self):
        student_src = ROOT / "apps" / "student" / "src"
        banned = [
            "فقط از ربات تلگرام",
            "در ربات رسمی تلگرام دریافت کنید",
            "خرید اشتراک در ربات تلگرام",
            "بدون پیش‌نمایش در ربات",
        ]
        hits = []
        for path in student_src.rglob("*"):
            if path.suffix in {".ts", ".tsx", ".css"}:
                text = path.read_text(encoding="utf-8", errors="ignore")
                for marker in banned:
                    if marker in text:
                        hits.append((str(path.relative_to(ROOT)), marker))
        self.assertEqual(hits, [], f"Forbidden bot-only blocker text found: {hits}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
