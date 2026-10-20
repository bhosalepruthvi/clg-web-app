import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import SubjectVault from './SubjectVault';
import InAppViewer from './InAppViewer';
import { LogoMark, IconBell, IconPin } from './icons';

/**
 * AttendanceDonutChart
 * Circular donut chart displaying attendance percentage.
 */
function AttendanceDonutChart({ percentage, present, absent, total }) {
  const radius = 54;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const isGoodStanding = percentage >= 75;
  const strokeColor = isGoodStanding ? '#16a34a' : '#f59e0b';

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-white rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100">
      {/* SVG Donut Circle */}
      <div className="relative flex items-center justify-center">
        <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
          {/* Background Track */}
          <circle
            stroke="#EEF2FF"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          {/* Progress Ring */}
          <circle
            stroke={strokeColor}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${circumference} ${circumference}`}
            style={{
              strokeDashoffset,
              transition: 'stroke-dashoffset 0.8s ease-in-out',
            }}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
        </svg>

        {/* Center Label */}
        <div className="absolute text-center">
          <span className="text-2xl font-extrabold text-indigo-900 tracking-tight leading-none block">
            {percentage}%
          </span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Overall
          </span>
        </div>
      </div>

      {/* Breakdown Details */}
      <div className="space-y-2 flex-1 text-center sm:text-left">
        <div className="flex items-center justify-center sm:justify-start gap-2">
          <span className="text-sm font-extrabold text-indigo-900">Attendance Standing</span>
          <span
            className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
              isGoodStanding
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {isGoodStanding ? 'Above 75% Safe' : 'Below 75% Warning'}
          </span>
        </div>

        <p className="text-xs text-slate-500">
          You have attended <strong className="text-indigo-900">{present}</strong> out of{' '}
          <strong className="text-indigo-900">{total}</strong> conducted lectures & practicals.
        </p>

        {/* Micro metric pills */}
        <div className="flex items-center justify-center sm:justify-start gap-3 pt-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <span className="w-2 h-2 rounded-full bg-green-600" />
            <span>Present: {present}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>Absent: {absent}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  // null until the real stats load — no invented placeholder numbers
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [notices, setNotices] = useState([]);
  const [loadingNotices, setLoadingNotices] = useState(true);
  const [viewingFile, setViewingFile] = useState(null); // Active file in InAppViewer
  const navigate = useNavigate();

  // Retrieve authenticated student profile from localStorage
  const student = JSON.parse(localStorage.getItem('studyflow_student') || '{}');
  const rollNumber = student.roll_number || student.ROLL_NUMBER || '36';
  const name = student.name || student.NAME || 'Student';
  const academicYear = student.academic_year || student.ACADEMIC_YEAR || 'FE';
  const branch = student.branch || student.BRANCH || 'Common';
  const division = student.division || student.DIVISION || 'E';
  const batch = student.batch || student.BATCH || 'E1';
  const accessCode = student.access_code || student.ACCESS_CODE || 'FE-E-E1-36';

  // Fetch student's real-time attendance stats
  useEffect(() => {
    const fetchAttendance = async () => {
      try {
        const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
        const res = await fetch('/api/attendance/student', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.stats) {
          setStats(data.stats);
        }
      } catch (err) {
        console.error('Failed to load attendance metrics', err);
      } finally {
        setLoadingStats(false);
      }
    };

    fetchAttendance();
  }, []);

  // Fetch notices targeted to this student's year/branch/division/batch
  useEffect(() => {
    const fetchNotices = async () => {
      try {
        const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
        const res = await fetch('/api/notices/student', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.notices) {
          setNotices(data.notices);
        }
      } catch (err) {
        console.error('Failed to load notices', err);
      } finally {
        setLoadingNotices(false);
      }
    };

    fetchNotices();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('studyflow_jwt');
    localStorage.removeItem('studyflow_token');
    localStorage.removeItem('studyflow_role');
    localStorage.removeItem('studyflow_student');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-indigo-50 pb-16">
      {/* Top Navbar */}
      <header className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-4 px-4 sm:px-8 shadow-md shadow-indigo-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
              <LogoMark className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight leading-none">StudyFlow</h1>
              <p className="text-[10px] text-indigo-100">Student Portal</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs transition-colors border border-white/20"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-8 mt-6 space-y-6">
        {/* Personalized Header Banner */}
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white p-6 sm:p-8 rounded-2xl shadow-lg shadow-indigo-500/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-white/20">
                {academicYear} &bull; {branch}
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-white/15">
                Div {division} &bull; Batch {batch}
              </span>
            </div>

            {/* Crucial requirement: 'Welcome, Roll No. 36' */}
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Welcome, Roll No. {rollNumber}
            </h2>
            <p className="text-xs sm:text-sm text-indigo-100 font-medium">
              Logged in as <strong className="text-white">{name}</strong> &bull; Access Code:{' '}
              <span className="font-mono font-bold text-white bg-white/15 rounded px-1.5 py-0.5">
                {accessCode}
              </span>
            </p>
          </div>

          {/* Quick Year/Batch Tag Badge */}
          <div className="p-4 bg-white/10 rounded-2xl border border-white/15 text-center self-start md:self-auto min-w-[130px]">
            <span className="text-[10px] font-bold text-indigo-100 uppercase tracking-wider block">
              Assigned Batch
            </span>
            <span className="text-2xl font-extrabold font-mono mt-0.5 block">{batch}</span>
            <span className="text-[10px] font-semibold text-indigo-100">Div {division} Lab</span>
          </div>
        </div>

        {/* Donut Chart Attendance Widget */}
        <section>
          {loadingStats ? (
            <div className="p-6 bg-white rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 text-center text-sm font-semibold text-slate-500">
              Loading attendance…
            </div>
          ) : stats && stats.percentage !== null ? (
            <AttendanceDonutChart
              percentage={stats.percentage}
              present={stats.present}
              absent={stats.absent}
              total={stats.total}
            />
          ) : (
            <div className="p-6 bg-white rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 text-center">
              <p className="text-sm font-extrabold text-indigo-900">No attendance recorded yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Your attendance summary will appear here once your teachers mark a class.
              </p>
            </div>
          )}
        </section>

        {/* Notices from teachers */}
        <section className="bg-white rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 p-6">
          <h3 className="flex items-center gap-2 text-lg font-extrabold text-indigo-900 mb-4">
            <IconBell className="w-5 h-5 text-indigo-600" />
            Notice Board
          </h3>
          {loadingNotices ? (
            <p className="text-sm text-slate-400 font-semibold">Loading notices…</p>
          ) : notices.length === 0 ? (
            <p className="text-sm text-slate-400">No notices for your class right now.</p>
          ) : (
            <div className="space-y-3">
              {notices.map((n) => {
                const nid = n.id ?? n.ID;
                const pinned = Number(n.is_pinned ?? n.IS_PINNED) === 1;
                const teacherName = n.teacher_name ?? n.TEACHER_NAME;
                const createdAt = n.created_at ?? n.CREATED_AT;
                const targetBatch = n.batch ?? n.BATCH;
                return (
                  <div
                    key={nid}
                    className={`rounded-xl border p-4 ${
                      pinned
                        ? 'border-amber-300 bg-amber-50/50'
                        : 'border-indigo-100 bg-indigo-50/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      {pinned && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-extrabold uppercase rounded-full">
                          <IconPin className="w-3 h-3" />
                          Pinned
                        </span>
                      )}
                      {targetBatch && (
                        <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-mono font-bold rounded">
                          Batch {targetBatch}
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-extrabold text-indigo-900">
                      {n.title ?? n.TITLE}
                    </h4>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap mt-1">
                      {n.body ?? n.BODY}
                    </p>
                    <p className="text-[11px] text-slate-400 font-medium mt-2">
                      {teacherName && <>By {teacherName} · </>}
                      {createdAt && new Date(createdAt).toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Subject Vault Component */}
        <section>
          <SubjectVault onSelectFile={(file) => setViewingFile(file)} />
        </section>
      </main>

      {/* In-App PDF Viewer Modal */}
      {viewingFile && (
        <InAppViewer file={viewingFile} onClose={() => setViewingFile(null)} />
      )}
    </div>
  );
}
