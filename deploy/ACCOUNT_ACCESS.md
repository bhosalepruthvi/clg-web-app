# Account access

Teachers enroll students and share a private, random registration code. No student temporary password is generated. Students choose Create Account, enter their registration code, email and password, and then sign in with email and password. Codes can be claimed once. Existing activated accounts retain legacy code/password login.

Student directory exports the filtered roster and unused registration codes. Registered students have no reusable registration code. Existing students awaiting activation need an assigned teacher to reissue a registration code. This preserves their records and attendance and revokes prior sessions.

Change Password is in the teacher Profile page and student profile menu. Forgotten student passwords use teacher-assisted code reissue after identity verification. Forgotten teacher passwords use the configured administrator reset. Email delivery and email ownership verification are not configured.

Before starting this release, build the app image and run: docker compose run --rm --no-deps app node deploy/migrate-student-registration.cjs
The migration adds email and registration_code columns and unique indexes without modifying existing account data. Only start the new app after the migration succeeds.

Administrators are configured by the deployment owner through ADMIN_TEACHER_IDS. Share registration codes privately. Never publish roster exports containing unused codes.
