# StudyFlow VM deployment

Status: prepared locally; not deployed or Docker-tested yet. Requires a Linux VM
with Docker Engine and Compose, plus a hostname pointing to the VM's public IP.

Copy the source to the server. Transfer `.env` and `wallet/` separately over SSH;
do not commit them or include them in an image. Restrict their filesystem access
while allowing container UID 1000 to read the wallet.

Add `APP_DOMAIN=your-hostname` to the server's `.env`. Keep the existing JWT,
Oracle, administrator and VAPID settings. Set a private `FACULTY_INVITE_CODE`
so invited teachers can register in production. Share that code only with faculty.

Allow inbound TCP 80/443 for the website and SSH only from the administrator's IP
in the VM firewall and Oracle security rules. Do not expose port 3000.

From the project directory on the VM:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app proxy
```

Caddy provisions HTTPS for the configured hostname. Verify faculty login,
administrator access, teacher invitations, a student login, PDF upload/download,
and browser push permission on the final HTTPS URL. A successful health endpoint
alone does not verify these workflows.

Uploads and archived files persist in `studyflow_data`; HTTPS state persists in
`caddy_data`. Back up these volumes, the Oracle database, wallet and `.env`.
Do not run `docker compose down -v` against a live deployment: it removes volumes.
Run one app instance so reminder delivery is not duplicated.

Existing local uploaded files, if any, need copying into the corresponding
`/data/uploads` and `/data/private-files` directories before rollout.
