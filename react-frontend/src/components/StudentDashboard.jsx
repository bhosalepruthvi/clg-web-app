import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import SubjectVault from './SubjectVault';
import InAppViewer from './InAppViewer';

/**
 * AttendanceDonutChart
 * High-performance circular donut chart displaying attendance percentage.
 */
function AttendanceDonutChart({ percentage = 85, present = 25, absent = 3, total = 28 }) {
  const radius = 54;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const isGoodStanding = percentage >= 75;
  const strokeColor = isGoodStanding ? '#10b981' : '#f59e0b';

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
      {/* SVG Donut Circle */}
      <div className="relative flex items-center justify-center">
        <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
          {/* Background Track */}
          <circle
            stroke="#f1f5f9"
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
          <span className="text-2xl font-black text-slate-800 tracking-tight leading-none block">
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
          <span className="text-sm font-extrabold text-slate-800">Attendance Standing</span>
          <span
            className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
              isGoodStanding
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {isGoodStanding ? 'Above 75% Safe' : 'Below 75% Warning'}
          </span>
        </div>

        <p className="text-xs text-slate-500">
          You have attended <strong className="text-slate-800">{present}</strong> out of{' '}
          <strong className="text-slate-800">{total}</strong> conducted lectures & practicals.
        </p>

        {/* Micro metric pills */}
        <div className="flex items-center justify-center sm:justify-start gap-3 pt-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
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

  const handleLogout = () => {
    localStorage.removeItem('studyflow_jwt');
    localStorage.removeItem('studyflow_token');
    localStorage.removeItem('studyflow_role');
    localStorage.removeItem('studyflow_student');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-16">
      {/* Top Navbar */}
      <header className="bg-gradient-to-r from-indigo-900 via-indigo-950 to-[#1e3a5f] text-white py-4 px-4 sm:px-8 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center font-black text-sm shadow-md">
              SF
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight leading-none">StudyFlow</h1>
              <p className="text-[10px] text-indigo-200">Student Portal</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs transition-colors border border-white/15"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-8 mt-6 space-y-6">
        {/* Personalized Header Banner */}
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-black bg-indigo-100 text-indigo-800 uppercase tracking-wider">
                {academicYear} &bull; {branch}
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 text-slate-700">
                Div {division} &bull; Batch {batch}
              </span>
            </div>

            {/* Crucial requirement: 'Welcome, Roll No. 36' */}
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
              Welcome, Roll No. {rollNumber}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              Logged in as <strong className="text-slate-800">{name}</strong> &bull; Access Code:{' '}
              <span className="font-mono font-bold text-indigo-600">{accessCode}</span>
            </p>
          </div>

          {/* Quick Year/Batch Tag Badge */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center self-start md:self-auto min-w-[130px]">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Assigned Batch
            </span>
            <span className="text-2xl font-black text-indigo-600 font-mono mt-0.5 block">
              {batch}
            </span>
            <span className="text-[10px] font-semibold text-slate-500">Div {division} Lab</span>
          </div>
        </div>

        {/* Donut Chart Attendance Widget */}
        <section>
          {loadingStats ? (
            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm text-center text-sm font-semibold text-slate-500">
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
            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm text-center">
              <p className="text-sm font-extrabold text-slate-800">No attendance recorded yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Your attendance summary will appear here once your teachers mark a class.
              </p>
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
