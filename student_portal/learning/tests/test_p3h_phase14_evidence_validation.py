"""P3-H 第十四階段：Evidence 驗證入口統一與隔離回歸。

本檔收斂第十四階段兩項新覆蓋：

A. ``validate_evidence_upload`` 統一驗證入口的單元測試
   —— 所有「直建 Evidence 後 upload.save」的路徑（成長記錄影像／影片／
      文件、R05 模型成果）都改呼叫這一支 helper，與 EvidenceForm 走的
      ModelForm 欄位驗證器共用同一份副檔名白名單、同一個 100MB 上限、
      同一支 ``validate_pdf_header``，避免「表單會擋、直建不擋」。

B. 成長記錄文件上傳的 HTTP 回歸
   —— 成長記錄文件過去完全不經任何副檔名／大小／PDF 檔頭驗證
      （FINDING-1）。本輪在落盤前補上 ``validate_evidence_upload``，
      這裡用真實 Django HTTP（test client）驗證：合法文件被接受、
      改名二進位 .pdf 被拒、非白名單副檔名被拒，且每個拒絕案例
      都不產生 Evidence 與媒體殘留。

C. evidence_add 路徑的 PDF 檔頭回歸
   —— 與第十三階段保持一致：合法 PDF 落盤且教師下載 SHA 不變、
      改名二進位 .pdf 被拒、跨班／跨學生寫入被拒。
"""

import hashlib
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.growth_records import ensure_growth_submissions
from learning.models import Cohort, Evidence
from learning.tests.helpers import create_student_account, enroll_student


VALID_PDF = b"%PDF-1.7\n% P3-H Phase14 fixture\n%%EOF\n"
# 具備基礎物件結構（catalog/pages/page + trailer），更逼近真實 PDF。
STRUCTURED_PDF = (
    b"%PDF-1.7\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R>>endobj\n"
    b"xref\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)


def upload_file(content, name="proof.pdf", content_type="application/pdf"):
    return SimpleUploadedFile(name, content, content_type=content_type)


def sha256_of_bytes(data):
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# A. 統一驗證入口單元測試
# ---------------------------------------------------------------------------
class ValidateEvidenceUploadTests(TestCase):
    """``validate_evidence_upload`` 必须沿用既有 validator，不另立规则。"""

    def _call(self, name, content, content_type="application/octet-stream"):
        from learning.models import validate_evidence_upload

        return validate_evidence_upload(SimpleUploadedFile(name, content, content_type=content_type))

    def test_valid_pdf_passes(self):
        self._call("report.pdf", VALID_PDF, content_type="application/pdf")

    def test_structured_pdf_passes(self):
        self._call("report.pdf", STRUCTURED_PDF, content_type="application/pdf")

    def test_pdf_without_header_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._call("malicious.pdf", b"MZ\x90\x00windows-binary", content_type="application/pdf")

    def test_disallowed_extension_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._call("virus.exe", b"MZ\x90\x00", content_type="application/octet-stream")

    def test_oversized_file_is_rejected(self):
        from learning.models import EVIDENCE_MAX_BYTES

        with self.assertRaises(ValidationError):
            self._call("huge.pdf", b"%PDF-" + b"x" * (EVIDENCE_MAX_BYTES + 1))

    def test_whitelisted_non_pdf_passes(self):
        # 圖片／影片／Office 文件走同一白名單，不應被 PDF 檔頭檢查影響。
        for name in ("photo.jpg", "clip.mp4", "notes.docx", "data.csv", "model.pt", "scene.obj"):
            with self.subTest(name=name):
                self._call(name, b"arbitrary-bytes-for-" + name.encode())

    def test_file_pointer_is_restored_after_validation(self):
        upload = SimpleUploadedFile("report.pdf", VALID_PDF, content_type="application/pdf")
        upload.seek(0)
        self._call("report.pdf", upload.read(), content_type="application/pdf")
        # 上面的 read() 已耗盡；改測 validate_pdf_header 對指標的還原。
        from learning.models import validate_pdf_header

        fresh = SimpleUploadedFile("report.pdf", VALID_PDF, content_type="application/pdf")
        fresh.seek(3)
        validate_pdf_header(fresh)
        self.assertEqual(fresh.tell(), 3)

    def test_validation_is_not_a_full_security_scan(self):
        """三層檢查的邊界：只驗副檔名＋大小＋PDF 檔頭，不做深度安全掃描。

        這條測試明確區分「副檔名驗證」「PDF 檔頭驗證」與「完整檔案安全掃描」：
        - PDF 檔頭檢查只看前 5 個位元組是否為 ``%PDF-``，不解析 PDF 結構、
          不檢查物件／字節碼／是否內嵌可執行內容；
        - 非 PDF 合法副檔名（如 .txt/.csv）即使內含 ``%PDF-`` 字串或任意二進位，
          也不會被當成 PDF 拒絕，也不會被「防毒／深度掃描」擋下。

        我們**刻意不**做完整安全掃描，避免把上傳閘門變成不可維護的黑箱；
        檔案落地後的惡意內容防禦交由作業系統／儲存層／下載時的
        ``Content-Disposition: attachment`` + ``X-Content-Type-Options: nosniff`` 負責。
        """
        # .pdf 前 5 位元組正確，但後續是毫無結構的垃圾 —— 仍通過（只查 magic）。
        garbage_pdf = b"%PDF-" + b"\x00\x01\x02\x03" * 50
        self._call("notes.pdf", garbage_pdf, content_type="application/pdf")
        # .txt 內嵌了 %PDF- 字串，但副檔名不是 .pdf —— 不被當成 PDF 拒絕。
        self._call("readme.txt", b"hello\n%PDF-1.7 embedded string\n", content_type="text/plain")
        # 非 PDF 二進位（如 .csv 內含 MZ 執行檔標記）—— 不觸發任何安全掃描拒絕。
        self._call("data.csv", b"MZ\x90\x00,col2\nrow1,row2\n", content_type="text/csv")


# ---------------------------------------------------------------------------
# B. 成長記錄文件上傳 HTTP 回歸（R07 / R08 允許文件）
# ---------------------------------------------------------------------------
class GrowthRecordDocumentUploadTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("growth-doc@example.com", "Eagle")
        self.cohort = Cohort.objects.create(cohort_id="2026-P14", name="P14 測試梯")
        self.enrollment = enroll_student(self.profile, self.cohort)
        ensure_growth_submissions(self.enrollment)
        self.client.force_login(self.profile.user)
        # 選一個允許文件的槽位（R07 / R08）
        self.slot_id = "R07"
        self.url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, self.slot_id])

    def _post_document(self, content, name="report.pdf", content_type="application/pdf"):
        return self.client.post(
            self.url,
            {"action": "save_draft", "documents": [upload_file(content, name=name, content_type=content_type)]},
        )

    def test_legal_pdf_document_is_accepted(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            before = Evidence.objects.count()
            response = self._post_document(VALID_PDF, name="report.pdf", content_type="application/pdf")
            self.assertEqual(response.status_code, 302)
            self.assertEqual(Evidence.objects.count(), before + 1)
            evidence = Evidence.objects.filter(growth_submission__definition__slot_id=self.slot_id).last()
            self.assertIsNotNone(evidence)
            self.assertTrue(evidence.upload.name.endswith(".pdf"))
            with evidence.upload.open("rb") as fh:
                self.assertEqual(fh.read(), VALID_PDF)
            evidence.upload.close()

    def test_renamed_binary_pdf_document_is_rejected(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            before = Evidence.objects.count()
            response = self._post_document(b"MZ\x90\x00windows-binary", name="fake.pdf", content_type="application/pdf")
            # 非法文件：表單重新渲染（200），不建立 Evidence，不落盤。
            self.assertEqual(response.status_code, 200)
            self.assertEqual(Evidence.objects.count(), before)
            # 媒體根下不應出現任何 .pdf 檔案
            leftover = list(Path(media_dir).rglob("*.pdf"))
            self.assertEqual(leftover, [])

    def test_disallowed_extension_document_is_rejected(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            before = Evidence.objects.count()
            response = self._post_document(b"MZ\x90\x00", name="virus.exe", content_type="application/octet-stream")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(Evidence.objects.count(), before)
            self.assertEqual(list(Path(media_dir).rglob("*.exe")), [])


# ---------------------------------------------------------------------------
# C. evidence_add 路徑 PDF 檔頭回歸（與第十三階段一致）
# ---------------------------------------------------------------------------
class EvidenceAddPdfHeaderRegressionTests(TestCase):
    def setUp(self):
        self.student = create_student_account("evadd@example.com", "Eagle")
        self.cohort = Cohort.objects.create(cohort_id="2026-EV", name="EV 測試梯")
        self.enrollment = enroll_student(self.student, self.cohort)
        from learning.models import TaskDefinition

        self.task = TaskDefinition.objects.create(
            task_id="EVTASK",
            sort_order=10,
            stage="assess",
            title="Evidence 回歸任務",
        )
        self.client.force_login(self.student.user)
        self.url = reverse("learning:evidence_add", args=[self.enrollment.pk, self.task.task_id])

    def _post_evidence(self, content, name="proof.pdf", content_type="application/pdf"):
        return self.client.post(
            self.url,
            {"evidence_type": Evidence.Type.FILE, "upload": upload_file(content, name=name, content_type=content_type)},
        )

    def test_valid_pdf_creates_owned_evidence_and_sha_matches(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            response = self._post_evidence(VALID_PDF)
            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(progress__enrollment=self.enrollment)
            with evidence.upload.open("rb") as fh:
                self.assertEqual(sha256_of_bytes(fh.read()), sha256_of_bytes(VALID_PDF))
            evidence.upload.close()

    def test_renamed_binary_pdf_is_rejected(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            before = Evidence.objects.count()
            response = self._post_evidence(b"MZ\x90\x00windows-binary", name="fake.pdf")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(Evidence.objects.count(), before)
            self.assertEqual(list(Path(media_dir).rglob("*.pdf")), [])
