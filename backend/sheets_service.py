"""Google Sheets Service for Motivational Shorts Studio.

Supports secure Google Service Account authentication via gspread and google-auth,
as well as fallback inspection for public spreadsheets.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("shorts-studio.sheets")

# Google Sheets API Scopes
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]


def extract_spreadsheet_id_and_gid(url_or_id: str) -> Tuple[str, Optional[int]]:
    """Extract the Google Spreadsheet ID and optional gid (sheet ID) from a URL or raw ID."""
    clean = url_or_id.strip()

    # Pattern for Google Docs Spreadsheet URL: /spreadsheets/d/<ID>/...
    match_id = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", clean)
    sheet_id = match_id.group(1) if match_id else clean

    # Pattern for gid: gid=12345
    match_gid = re.search(r"[#&?]gid=([0-9]+)", clean)
    gid = int(match_gid.group(1)) if match_gid else None

    return sheet_id, gid


class GoogleSheetsService:
    """Manages Google Sheets authentication, inspection, row extraction, and status updates."""

    def __init__(self, backend_dir: Optional[Path] = None):
        self.backend_dir = backend_dir or Path(__file__).parent.resolve()
        self._client = None
        self._service_account_info: Optional[Dict[str, Any]] = None

    def get_credentials_path(self) -> Optional[Path]:
        """Locate the service account JSON credentials file if present."""
        # 1. Environment variable GOOGLE_SERVICE_ACCOUNT_FILE
        env_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
        if env_path:
            p = Path(env_path)
            if not p.is_absolute():
                p = self.backend_dir / p
            if p.is_file():
                return p

        # 2. Standard GOOGLE_APPLICATION_CREDENTIALS
        gac_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if gac_path:
            p = Path(gac_path)
            if not p.is_absolute():
                p = self.backend_dir / p
            if p.is_file():
                return p

        # 3. Known default locations in backend directory
        for candidate in [
            "service_account.json",
            "credentials.json",
            "google_service_account.json",
            "service-account.json",
        ]:
            cand_path = self.backend_dir / candidate
            if cand_path.is_file():
                return cand_path

        return None

    def get_auth_status(self) -> Dict[str, Any]:
        """Check if Google Service Account credentials are configured."""
        cred_path = self.get_credentials_path()
        raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")

        email: Optional[str] = None
        project_id: Optional[str] = None
        configured = False
        source = None

        if cred_path and cred_path.is_file():
            try:
                with open(cred_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    email = data.get("client_email")
                    project_id = data.get("project_id")
                    configured = bool(email and data.get("private_key"))
                    source = cred_path.name
            except Exception as e:
                logger.warning(f"Failed to read credentials file {cred_path}: {e}")
        elif raw_json:
            try:
                data = json.loads(raw_json)
                email = data.get("client_email")
                project_id = data.get("project_id")
                configured = bool(email and data.get("private_key"))
                source = "GOOGLE_SERVICE_ACCOUNT_JSON (env)"
            except Exception as e:
                logger.warning(f"Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON env: {e}")

        instructions = (
            "To connect your Google Spreadsheet securely:\n"
            "1. In Google Cloud Console, enable the 'Google Sheets API'.\n"
            "2. Create a Service Account and download the private key as a JSON file.\n"
            "3. Place the file as 'backend/service_account.json' (or set GOOGLE_SERVICE_ACCOUNT_FILE in backend/.env).\n"
            f"4. Share your Google Spreadsheet with the service account email ({email or 'your-service-account@...'}) as 'Editor'."
        )

        return {
            "configured": configured,
            "serviceAccountEmail": email,
            "projectId": project_id,
            "credentialsSource": source,
            "instructions": instructions,
        }

    def _get_gspread_client(self):
        """Initialize or return cached gspread client using Service Account."""
        if self._client:
            return self._client

        import gspread
        from google.oauth2.service_account import Credentials

        cred_path = self.get_credentials_path()
        raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")

        creds = None
        if cred_path and cred_path.is_file():
            creds = Credentials.from_service_account_file(str(cred_path), scopes=SCOPES)
            with open(cred_path, "r", encoding="utf-8") as f:
                self._service_account_info = json.load(f)
        elif raw_json:
            info = json.loads(raw_json)
            creds = Credentials.from_service_account_info(info, scopes=SCOPES)
            self._service_account_info = info

        if not creds:
            raise ValueError(
                "Google Service Account credentials are not configured. "
                "Please place 'service_account.json' in the backend/ folder or set GOOGLE_SERVICE_ACCOUNT_FILE in backend/.env."
            )

        self._client = gspread.authorize(creds)
        return self._client

    def auto_detect_mapping(self, headers: List[str]) -> Dict[str, str]:
        """Automatically match spreadsheet headers to standard video generation fields."""
        norm_headers = {h.strip().lower().replace(" ", "_").replace("-", "_"): h for h in headers if h}

        mapping = {
            "quote": "",
            "video_url": "",
            "music_url": "",
            "title": "",
            "status": "",
            "output_url": "",
        }

        # 1. Quote / Motivational Text
        for pattern in ["quote", "quotes", "text", "motivational_text", "speech", "caption", "message", "content"]:
            for norm, orig in norm_headers.items():
                if pattern in norm:
                    mapping["quote"] = orig
                    break
            if mapping["quote"]:
                break

        # 2. Video URL
        for pattern in ["video_url", "videourl", "video", "bg_video", "background_video", "youtube_url", "video_link", "footage"]:
            for norm, orig in norm_headers.items():
                if pattern in norm and "output" not in norm and "render" not in norm:
                    mapping["video_url"] = orig
                    break
            if mapping["video_url"]:
                break

        # 3. Music / Soundtrack URL
        for pattern in ["music_url", "musicurl", "music", "audio_url", "audiourl", "soundtrack", "audio", "bg_music", "sound"]:
            for norm, orig in norm_headers.items():
                if pattern in norm:
                    mapping["music_url"] = orig
                    break
            if mapping["music_url"]:
                break

        # 4. Title
        for pattern in ["title", "short_title", "video_title", "name", "topic"]:
            for norm, orig in norm_headers.items():
                if pattern == norm or (pattern in norm and "url" not in norm):
                    mapping["title"] = orig
                    break
            if mapping["title"]:
                break

        # 5. Status
        for pattern in ["status", "state", "progress", "generation_status"]:
            for norm, orig in norm_headers.items():
                if pattern in norm:
                    mapping["status"] = orig
                    break
            if mapping["status"]:
                break

        # 6. Output URL
        for pattern in ["output_url", "video_output", "rendered_url", "download_url", "result_url"]:
            for norm, orig in norm_headers.items():
                if pattern in norm:
                    mapping["output_url"] = orig
                    break
            if mapping["output_url"]:
                break

        return mapping

    async def inspect_spreadsheet(
        self,
        url_or_id: str,
        sheet_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Inspect spreadsheet tabs, column headers, and sample rows."""
        sheet_id, gid = extract_spreadsheet_id_and_gid(url_or_id)
        if not sheet_id:
            raise ValueError("Invalid Google Sheets URL or Spreadsheet ID.")

        auth_info = self.get_auth_status()

        # Try Google Service Account authentication first if configured
        if auth_info["configured"]:
            try:
                client = self._get_gspread_client()
                spreadsheet = client.open_by_key(sheet_id)

                worksheets = spreadsheet.worksheets()
                sheets_meta = [
                    {"title": ws.title, "id": ws.id, "rowCount": ws.row_count}
                    for ws in worksheets
                ]

                # Select active worksheet by name, or gid, or first sheet
                active_ws = None
                if sheet_name:
                    try:
                        active_ws = spreadsheet.worksheet(sheet_name)
                    except Exception:
                        pass

                if not active_ws and gid is not None:
                    for ws in worksheets:
                        if ws.id == gid:
                            active_ws = ws
                            break

                if not active_ws:
                    active_ws = worksheets[0]

                # Fetch all values
                all_values = active_ws.get_all_values()
                headers = all_values[0] if all_values else []
                data_rows = all_values[1:] if len(all_values) > 1 else []

                detected_mapping = self.auto_detect_mapping(headers)

                # Process sample rows with validation checks
                sample_rows = []
                valid_count = 0
                for idx, row in enumerate(data_rows, start=2):
                    row_dict = {}
                    for col_idx, col_name in enumerate(headers):
                        row_dict[col_name] = row[col_idx] if col_idx < len(row) else ""

                    q_val = row_dict.get(detected_mapping.get("quote", ""), "").strip()
                    v_val = row_dict.get(detected_mapping.get("video_url", ""), "").strip()
                    is_valid = bool(q_val and v_val)
                    if is_valid:
                        valid_count += 1

                    if len(sample_rows) < 8:
                        sample_rows.append({
                            "rowNumber": idx,
                            "data": row_dict,
                            "isValid": is_valid,
                            "quote": q_val,
                            "videoUrl": v_val,
                            "musicUrl": row_dict.get(detected_mapping.get("music_url", ""), "").strip(),
                            "title": row_dict.get(detected_mapping.get("title", ""), "").strip(),
                            "status": row_dict.get(detected_mapping.get("status", ""), "").strip(),
                        })

                return {
                    "success": True,
                    "spreadsheetId": sheet_id,
                    "spreadsheetTitle": spreadsheet.title,
                    "sheets": sheets_meta,
                    "activeSheet": active_ws.title,
                    "headers": headers,
                    "detectedMapping": detected_mapping,
                    "totalRows": len(data_rows),
                    "validRowsCount": valid_count,
                    "sampleRows": sample_rows,
                    "authMode": "service_account",
                    "serviceAccountEmail": auth_info["serviceAccountEmail"],
                }

            except Exception as e:
                err_str = str(e)
                logger.error(f"Service Account failed to open spreadsheet {sheet_id}: {err_str}")
                if "PERMISSION_DENIED" in err_str or "403" in err_str or "404" in err_str:
                    email = auth_info.get("serviceAccountEmail") or "your service account email"
                    raise PermissionError(
                        f"Permission denied accessing Google Spreadsheet.\n\n"
                        f"Action Required:\n"
                        f"1. Open your Google Spreadsheet in your browser.\n"
                        f"2. Click the 'Share' button in the top right.\n"
                        f"3. Add this Service Account email as an 'Editor' (or 'Viewer'):\n"
                        f"   {email}\n"
                        f"4. Click 'Send' and test the connection again."
                    )
                raise e

        # Fallback for public sheet export (format=csv)
        export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
        if gid is not None:
            export_url += f"&gid={gid}"

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(export_url)

        if resp.status_code == 200 and "html" not in resp.headers.get("content-type", "").lower():
            csv_text = resp.text
            reader = csv.reader(io.StringIO(csv_text))
            all_rows = list(reader)
            headers = all_rows[0] if all_rows else []
            data_rows = all_rows[1:] if len(all_rows) > 1 else []

            detected_mapping = self.auto_detect_mapping(headers)

            sample_rows = []
            valid_count = 0
            for idx, row in enumerate(data_rows, start=2):
                row_dict = {}
                for col_idx, col_name in enumerate(headers):
                    row_dict[col_name] = row[col_idx] if col_idx < len(row) else ""

                q_val = row_dict.get(detected_mapping.get("quote", ""), "").strip()
                v_val = row_dict.get(detected_mapping.get("video_url", ""), "").strip()
                is_valid = bool(q_val and v_val)
                if is_valid:
                    valid_count += 1

                if len(sample_rows) < 8:
                    sample_rows.append({
                        "rowNumber": idx,
                        "data": row_dict,
                        "isValid": is_valid,
                        "quote": q_val,
                        "videoUrl": v_val,
                        "musicUrl": row_dict.get(detected_mapping.get("music_url", ""), "").strip(),
                        "title": row_dict.get(detected_mapping.get("title", ""), "").strip(),
                        "status": row_dict.get(detected_mapping.get("status", ""), "").strip(),
                    })

            return {
                "success": True,
                "spreadsheetId": sheet_id,
                "spreadsheetTitle": "Public Google Sheet",
                "sheets": [{"title": "Default", "id": gid or 0, "rowCount": len(data_rows)}],
                "activeSheet": "Default",
                "headers": headers,
                "detectedMapping": detected_mapping,
                "totalRows": len(data_rows),
                "validRowsCount": valid_count,
                "sampleRows": sample_rows,
                "authMode": "public_csv_export",
                "serviceAccountEmail": None,
            }

        # Both service account and public export failed
        raise PermissionError(
            "Cannot access Google Spreadsheet (Private Sheet or Authentication Required).\n\n"
            "Action Required:\n"
            "1. Google Service Account credentials were not found in backend/service_account.json.\n"
            "2. Follow the setup guide to configure a Service Account, or share the spreadsheet as 'Anyone with link can view'."
        )

    async def get_all_rows(
        self,
        url_or_id: str,
        sheet_name: Optional[str] = None,
        mapping: Optional[Dict[str, str]] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch all rows from the specified sheet and map to video generation items."""
        sheet_id, gid = extract_spreadsheet_id_and_gid(url_or_id)
        auth_info = self.get_auth_status()

        headers: List[str] = []
        data_rows: List[List[str]] = []

        if auth_info["configured"]:
            client = self._get_gspread_client()
            spreadsheet = client.open_by_key(sheet_id)
            if sheet_name:
                ws = spreadsheet.worksheet(sheet_name)
            elif gid is not None:
                ws = next((w for w in spreadsheet.worksheets() if w.id == gid), spreadsheet.sheet1)
            else:
                ws = spreadsheet.sheet1

            all_values = ws.get_all_values()
            headers = all_values[0] if all_values else []
            data_rows = all_values[1:] if len(all_values) > 1 else []
        else:
            export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
            if gid is not None:
                export_url += f"&gid={gid}"
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(export_url)
            if resp.status_code != 200:
                raise PermissionError(f"Failed to fetch spreadsheet rows (HTTP {resp.status_code})")
            reader = csv.reader(io.StringIO(resp.text))
            all_rows = list(reader)
            headers = all_rows[0] if all_rows else []
            data_rows = all_rows[1:] if len(all_rows) > 1 else []

        active_map = mapping or self.auto_detect_mapping(headers)

        rows_result = []
        for idx, row in enumerate(data_rows, start=2):
            row_dict = {}
            for col_idx, col_name in enumerate(headers):
                row_dict[col_name] = row[col_idx] if col_idx < len(row) else ""

            quote_val = row_dict.get(active_map.get("quote", ""), "").strip()
            video_val = row_dict.get(active_map.get("video_url", ""), "").strip()
            music_val = row_dict.get(active_map.get("music_url", ""), "").strip()
            title_val = row_dict.get(active_map.get("title", ""), "").strip()
            status_val = row_dict.get(active_map.get("status", ""), "").strip()
            output_val = row_dict.get(active_map.get("output_url", ""), "").strip()

            is_valid = bool(quote_val and video_val)
            invalid_reasons = []
            if not quote_val:
                invalid_reasons.append("Missing quote/text")
            if not video_val:
                invalid_reasons.append("Missing video URL")

            publishing = {col: row_dict.get(col, "").strip() for col in PUBLISHING_COLUMNS}

            rows_result.append({
                "rowNumber": idx,
                "quote": quote_val,
                "videoUrl": video_val,
                "musicUrl": music_val,
                "title": title_val,
                "status": status_val,
                "outputUrl": output_val,
                "isValid": is_valid,
                "invalidReason": ", ".join(invalid_reasons) if invalid_reasons else None,
                "publishing": publishing,
                "raw": row_dict,
            })

        return rows_result

    async def update_row_status(
        self,
        url_or_id: str,
        row_number: int,
        new_status: str,
        output_url: Optional[str] = None,
        sheet_name: Optional[str] = None,
        status_column_name: Optional[str] = None,
        output_column_name: Optional[str] = None,
    ) -> bool:
        """Update a specific row's status and output URL in Google Sheets."""
        auth_info = self.get_auth_status()
        if not auth_info["configured"]:
            logger.info("Service Account not configured; skipping in-sheet status update.")
            return False

        try:
            sheet_id, gid = extract_spreadsheet_id_and_gid(url_or_id)
            client = self._get_gspread_client()
            spreadsheet = client.open_by_key(sheet_id)

            if sheet_name:
                ws = spreadsheet.worksheet(sheet_name)
            elif gid is not None:
                ws = next((w for w in spreadsheet.worksheets() if w.id == gid), spreadsheet.sheet1)
            else:
                ws = spreadsheet.sheet1

            headers = ws.row_values(1)

            # Find status column index (1-based)
            status_col_idx = None
            if status_column_name and status_column_name in headers:
                status_col_idx = headers.index(status_column_name) + 1
            else:
                for idx, h in enumerate(headers, start=1):
                    if "status" in h.lower():
                        status_col_idx = idx
                        break

            # Find output_url column index
            output_col_idx = None
            if output_column_name and output_column_name in headers:
                output_col_idx = headers.index(output_column_name) + 1
            else:
                for idx, h in enumerate(headers, start=1):
                    if any(p in h.lower() for p in ["output", "rendered", "download"]):
                        output_col_idx = idx
                        break

            if status_col_idx:
                ws.update_cell(row_number, status_col_idx, new_status)
                logger.info(f"Updated row {row_number} status to '{new_status}' in sheet '{ws.title}'.")

            if output_col_idx and output_url:
                ws.update_cell(row_number, output_col_idx, output_url)
                logger.info(f"Updated row {row_number} output_url to '{output_url}'.")

            return True
        except Exception as e:
            logger.warning(f"Could not update row {row_number} in Google Sheet: {e}")
            return False

    async def ensure_publishing_columns(
        self,
        url_or_id: str,
        sheet_name: Optional[str] = None,
    ) -> List[str]:
        """Ensure the 12 required publishing columns exist in the sheet's header row.

        Appends any missing columns to row 1.
        """
        auth_info = self.get_auth_status()
        if not auth_info["configured"]:
            logger.info("Service Account not configured; skipping column check.")
            return list(PUBLISHING_COLUMNS)

        try:
            sheet_id, gid = extract_spreadsheet_id_and_gid(url_or_id)
            client = self._get_gspread_client()
            spreadsheet = client.open_by_key(sheet_id)

            if sheet_name:
                ws = spreadsheet.worksheet(sheet_name)
            elif gid is not None:
                ws = next((w for w in spreadsheet.worksheets() if w.id == gid), spreadsheet.sheet1)
            else:
                ws = spreadsheet.sheet1

            existing_headers = ws.row_values(1)
            norm_existing = {h.strip().lower(): h for h in existing_headers if h}

            missing_cols = []
            for col in PUBLISHING_COLUMNS:
                if col.lower() not in norm_existing:
                    missing_cols.append(col)

            if missing_cols:
                start_col = len(existing_headers) + 1
                for idx, col_name in enumerate(missing_cols):
                    ws.update_cell(1, start_col + idx, col_name)
                logger.info(f"Added {len(missing_cols)} publishing columns to sheet '{ws.title}': {missing_cols}")
                existing_headers.extend(missing_cols)

            return existing_headers
        except Exception as e:
            logger.warning(f"Could not verify or add publishing columns: {e}")
            return []

    async def update_row_publishing_status(
        self,
        url_or_id: str,
        row_number: int,
        publishing_data: Dict[str, Any],
        sheet_name: Optional[str] = None,
    ) -> bool:
        """Update publishing status columns for a specific row in Google Sheet.

        Expected fields in publishing_data:
        - youtube_status, youtube_video_id, youtube_url
        - discord_status, discord_message_id
        - telegram_status, telegram_message_id
        - instagram_status, instagram_media_id, instagram_url
        - overall_publish_status, last_publish_attempt
        """
        auth_info = self.get_auth_status()
        if not auth_info["configured"]:
            logger.info("Service Account not configured; skipping publishing status update in Google Sheet.")
            return False

        try:
            sheet_id, gid = extract_spreadsheet_id_and_gid(url_or_id)
            client = self._get_gspread_client()
            spreadsheet = client.open_by_key(sheet_id)

            if sheet_name:
                ws = spreadsheet.worksheet(sheet_name)
            elif gid is not None:
                ws = next((w for w in spreadsheet.worksheets() if w.id == gid), spreadsheet.sheet1)
            else:
                ws = spreadsheet.sheet1

            headers = ws.row_values(1)
            norm_headers = {h.strip().lower(): idx + 1 for idx, h in enumerate(headers) if h}

            # If publishing headers are missing, auto-create them
            missing = [c for c in PUBLISHING_COLUMNS if c.lower() not in norm_headers]
            if missing:
                start_col = len(headers) + 1
                for idx, col_name in enumerate(missing):
                    ws.update_cell(1, start_col + idx, col_name)
                    norm_headers[col_name.lower()] = start_col + idx

            # Update cells
            for field, val in publishing_data.items():
                if field.lower() in norm_headers and val is not None:
                    col_idx = norm_headers[field.lower()]
                    str_val = str(val) if val != "" else ""
                    ws.update_cell(row_number, col_idx, str_val)

            logger.info(f"Updated row {row_number} publishing columns in sheet '{ws.title}'.")
            return True
        except Exception as e:
            logger.error(f"Failed to update publishing status in sheet for row {row_number}: {e}")
            return False


PUBLISHING_COLUMNS = [
    "youtube_status",
    "youtube_video_id",
    "youtube_url",
    "discord_status",
    "discord_message_id",
    "telegram_status",
    "telegram_message_id",
    "instagram_status",
    "instagram_media_id",
    "instagram_url",
    "overall_publish_status",
    "last_publish_attempt",
]

# Singleton instance
sheets_service = GoogleSheetsService()

