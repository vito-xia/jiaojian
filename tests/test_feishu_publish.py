import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "豆包工作" / "publish_feishu.py"
SPEC = importlib.util.spec_from_file_location("feishu_publish", SCRIPT)
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


def response(data=None, *, code=0, error=None):
    payload = {"ok": error is None, "data": data} if error is None else {"ok": False, "error": error}
    text = json.dumps(payload)
    return subprocess.CompletedProcess([], code, text if not code else "", text if code else "")


class FeishuPublishTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Doubao CLI location is Windows-specific")
    def test_doubao_cli_takes_precedence_over_old_path_installation(self):
        with tempfile.TemporaryDirectory(prefix="发布 检查 ") as directory:
            base = Path(directory) / "LarkShell/aha/users/user/doubao/sandbox_envs_dir/envs"
            old = base / "old/override_dlcs/lark-cli.exe"
            new = base / "new/override_dlcs/lark-cli.exe"
            for file in (old, new):
                file.parent.mkdir(parents=True)
                file.write_bytes(b"test")
            os.utime(old, (1, 1))
            os.utime(new, (2, 2))
            with patch.dict(os.environ, {"APPDATA": directory}), patch.object(publisher.shutil, "which") as which:
                self.assertEqual(Path(publisher.find_cli()), new)
                which.assert_not_called()

    def test_capability_detection_uses_only_local_help_and_handles_both_versions(self):
        for command in ("+deploy", "+html-publish"):
            with self.subTest(command=command):
                help_text = f"Available Commands:\n  +get Get app\n  +release-get Get release\n  {command} Publish app\n"
                with patch.object(publisher.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, help_text, "")) as run:
                    self.assertEqual(publisher.cli_publish_action("lark-cli.exe"), command)
                    self.assertEqual(run.call_args.args[0], ["lark-cli.exe", "apps", "--help"])

    def test_unusable_cli_stops_before_business_commands(self):
        with patch.object(publisher.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "Available Commands:\n  +get Get app\n", "")):
            with self.assertRaises(publisher.PublishError):
                publisher.cli_publish_action("lark-cli.exe")

    def test_zero_exit_with_error_json_is_failure(self):
        result = response(error={"message": "TOS upload failed", "hint": "Check connectivity"})
        with patch.object(publisher.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(publisher.PublishError, "TOS upload failed.*Check connectivity"):
                publisher.cli_data("lark-cli.exe", SCRIPT.parent, "+deploy")

    def test_nonzero_exit_with_success_json_is_failure(self):
        with patch.object(publisher.subprocess, "run", return_value=response({}, code=1)):
            with self.assertRaises(publisher.PublishError):
                publisher.cli_data("lark-cli.exe", SCRIPT.parent, "+deploy")

    def test_missing_authorization_from_stderr_is_reported(self):
        result = response(code=1, error={"message": "need_user_authorization", "hint": "Use the authorized terminal"})
        with patch.object(publisher.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(publisher.PublishError, "need_user_authorization.*authorized terminal"):
                publisher.cli_data("lark-cli.exe", SCRIPT.parent, "+get")

    def test_authorization_failure_does_not_build_or_upload(self):
        with patch.object(publisher, "cli_data", side_effect=publisher.PublishError("Not authorized")) as cli, \
                patch.object(publisher.subprocess, "run") as run, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(publisher.PublishError):
                publisher.publish(SCRIPT.parent, "npm.cmd", "lark-cli.exe", "+deploy")
            self.assertEqual(cli.call_count, 1)
            run.assert_not_called()

    def test_build_failure_stops_upload(self):
        app = {"app": {"app_id": publisher.APP_ID, "app_type": "HTML"}}
        with patch.object(publisher, "cli_data", return_value=app) as cli, \
                patch.object(publisher.subprocess, "run", return_value=subprocess.CompletedProcess([], 9)), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(publisher.PublishError, "构建失败"):
                publisher.publish(SCRIPT.parent, "npm.cmd", "lark-cli.exe", "+deploy")
            self.assertEqual(cli.call_count, 1)

    def test_publish_uses_matching_path_flag_and_waits_for_its_release(self):
        app = {"app": {"app_id": publisher.APP_ID, "app_type": "HTML"}}
        for action, flag in (("+deploy", "--dir"), ("+html-publish", "--path")):
            with self.subTest(action=action), \
                    patch.object(publisher, "cli_data", side_effect=[app, {"release_id": "release-test"}]) as cli, \
                    patch.object(publisher.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), \
                    patch.object(publisher, "check_dist"), \
                    patch.object(publisher, "wait_for_release", return_value="https://example.test/published") as wait, \
                    contextlib.redirect_stdout(io.StringIO()) as output:
                publisher.publish(SCRIPT.parent, "npm.cmd", "lark-cli.exe", action)
                self.assertEqual(cli.call_args.args[2:], (action, flag, "./dist"))
                wait.assert_called_once_with("lark-cli.exe", SCRIPT.parent, "release-test")
                self.assertIn("[成功]", output.getvalue())

    def test_upload_without_release_or_url_is_not_success(self):
        app = {"app": {"app_id": publisher.APP_ID}}
        with patch.object(publisher, "cli_data", side_effect=[app, {}]), \
                patch.object(publisher.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), \
                patch.object(publisher, "check_dist"), contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(publisher.PublishError):
                publisher.publish(SCRIPT.parent, "npm.cmd", "lark-cli.exe", "+deploy")
            self.assertNotIn("[成功]", output.getvalue())

    def test_pending_release_is_polled_until_finished(self):
        with patch.object(publisher, "cli_data", side_effect=[
            {"release": {"status": "publishing"}},
            {"release": {"status": "finished", "online_url": "https://example.test/online"}},
        ]), patch.object(publisher.time, "sleep") as sleep, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(publisher.wait_for_release("cli", SCRIPT.parent, "release-test"), "https://example.test/online")
            sleep.assert_called_once()

    def test_failed_release_and_pending_timeout_are_not_success(self):
        with patch.object(publisher, "cli_data", return_value={"status": "failed", "error_logs": "build error"}):
            with self.assertRaisesRegex(publisher.PublishError, "build error"):
                publisher.wait_for_release("cli", SCRIPT.parent, "release-test")
        with patch.object(publisher, "cli_data", return_value={"status": "publishing"}), \
                patch.object(publisher.time, "monotonic", side_effect=[0, publisher.RELEASE_TIMEOUT + 1]):
            with self.assertRaisesRegex(publisher.PublishError, "超时"):
                publisher.wait_for_release("cli", SCRIPT.parent, "release-test")

    def test_legacy_upload_rejects_git_managed_app(self):
        with self.assertRaises(publisher.PublishError):
            publisher.require_html_app({"app": {"app_id": publisher.APP_ID, "app_type": "MODERN_HTML"}})


if __name__ == "__main__":
    unittest.main()
