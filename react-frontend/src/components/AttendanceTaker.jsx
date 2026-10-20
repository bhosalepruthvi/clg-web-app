import React, { useState, useEffect } from 'react';

import { IconAlert, IconArrowRight, IconCheck, IconClipboard } from './icons';

export default function AttendanceTaker() {
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('All');
  const [attendanceDate, setAttendanceDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  const [students, setStudents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({}); // { [studentId]: 'Present' | 'Absent' }
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // 1. Fetch Teacher's Classes
  const fetchClasses = async () => {
    try {
      const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
      const res = await fetch('/api/classes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.classes) {
        setClasses(data.classes);
        if (data.classes.length > 0) {
          const firstId = String(data.classes[0].ID || data.classes[0].id);
          setSelectedClassId(firstId);
        }
      }
    } catch (err) {
      console.error('Failed to fetch classes', err);
    } finally {
      setLoadingClasses(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  // Determine current class and lab status
  const currentClass = classes.find(
    (c) => String(c.ID || c.id) === String(selectedClassId)
  );
  const isLab =
    currentClass &&
    (currentClass.CLASS_TYPE === 'Lab/Practical' || currentClass.class_type === 'Lab/Practical');
  const availableBatches = currentClass?.batches || [];

  // 2. Fetch Roster when class or batch changes
  const fetchRoster = async () => {
    if (!selectedClassId) return;

    setLoadingRoster(true);
    setMessage({ text: '', type: '' });

    try {
      const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
      let url = `/api/classes/${selectedClassId}/students`;
      if (isLab && selectedBatch && selectedBatch !== 'All') {
        url += `?batch=${encodeURIComponent(selectedBatch)}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok && data.students) {
        setStudents(data.students);
        // Default everyone to 'Present' initially
        const initialMap = {};
        data.students.forEach((s) => {
          initialMap[s.ID || s.id] = 'Present';
        });
        setAttendanceMap(initialMap);
      } else {
        setStudents([]);
        setAttendanceMap({});
      }
    } catch (err) {
      console.error('Failed to load roster', err);
      setMessage({ text: 'Failed to load student roster.', type: 'error' });
    } finally {
      setLoadingRoster(false);
    }
  };

  useEffect(() => {
    if (selectedClassId) {
      fetchRoster();
    }
  }, [selectedClassId, selectedBatch]);

  // Master Toggle: Mark All Present
  const handleMarkAll = (status) => {
    const updated = {};
    students.forEach((s) => {
      updated[s.ID || s.id] = status;
    });
    setAttendanceMap(updated);
  };

  // Toggle individual student
  const toggleStudent = (studentId) => {
    setAttendanceMap((prev) => ({
      ...prev,
      [studentId]: prev[studentId] === 'Present' ? 'Absent' : 'Present',
    }));
  };

  // Stats
  const totalStudents = students.length;
  const presentCount = Object.values(attendanceMap).filter((s) => s === 'Present').length;
  const absentCount = totalStudents - presentCount;
  const percentage = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

  // Submit Attendance
  const handleSubmitAttendance = async () => {
    if (students.length === 0) {
      setMessage({ text: 'No students to record attendance for.', type: 'error' });
      return;
    }

    setSubmitting(true);
    setMessage({ text: '', type: '' });

    try {
      const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
      const records = students.map((s) => {
        const sId = s.ID || s.id;
        return {
          student_id: sId,
          status: attendanceMap[sId] || 'Present',
        };
      });

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          class_id: selectedClassId,
          date: attendanceDate,
          records,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({
          text: `Attendance saved! ${presentCount} Present, ${absentCount} Absent (${percentage}% attendance).`,
          type: 'success',
        });
      } else {
        setMessage({ text: data.error || 'Failed to submit attendance.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Network connection failed during submission.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
            Roll Call Portal
          </span>
          <h2 className="text-2xl font-black text-indigo-900 mt-2">Take Attendance</h2>
          <p className="text-xs text-slate-500 mt-1">
            Fast 60-second attendance logging with instant batch filters and toggle switches.
          </p>
        </div>

        {totalStudents > 0 && (
          <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
            <div className="text-center px-3 py-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Total</span>
              <span className="text-sm font-extrabold text-slate-700">{totalStudents}</span>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div className="text-center px-3 py-1">
              <span className="text-[10px] uppercase font-bold text-emerald-600 block">Present</span>
              <span className="text-sm font-extrabold text-emerald-600">{presentCount}</span>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div className="text-center px-3 py-1">
              <span className="text-[10px] uppercase font-bold text-red-500 block">Absent</span>
              <span className="text-sm font-extrabold text-red-500">{absentCount}</span>
            </div>
          </div>
        )}
      </div>

      {loadingClasses ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 text-sm">
          Loading classes...
        </div>
      ) : classes.length === 0 ? (
        <div className="bg-white p-10 rounded-2xl border border-indigo-200/70 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-400 flex items-center justify-center">
            <IconClipboard className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-indigo-900">No Classes Available</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Please create a class in <strong>Class Manager</strong> first to record attendance.
          </p>
        </div>
      ) : (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 space-y-6">
          {/* Class, Batch & Date Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-6 border-b border-slate-100">
            {/* Select Class */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Class / Subject
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => {
                  setSelectedClassId(e.target.value);
                  setSelectedBatch('All');
                }}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              >
                {classes.map((cls) => {
                  const cId = cls.ID || cls.id;
                  const year = cls.ACADEMIC_YEAR || cls.academic_year;
                  const br = cls.BRANCH || cls.branch;
                  const div = cls.DIVISION || cls.division;
                  const sub = cls.SUBJECT_NAME || cls.subject_name;
                  const type = cls.CLASS_TYPE || cls.class_type;

                  return (
                    <option key={cId} value={cId}>
                      {sub} ({year}-{br} Div {div}) [{type}]
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Select Batch (if Lab) */}
            {isLab ? (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-violet-700 mb-1.5">
                  Lab Batch
                </label>
                <select
                  value={selectedBatch}
                  onChange={(e) => setSelectedBatch(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-violet-50 border border-violet-200 rounded-xl text-violet-950 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white"
                >
                  <option value="All">All Batches</option>
                  {availableBatches.map((b) => {
                    const bName = b.BATCH_NAME || b.batch_name;
                    return (
                      <option key={b.ID || b.id || bName} value={bName}>
                        Batch {bName}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Session Type
                </label>
                <div className="px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 text-sm font-medium">
                  Theory Lecture (Whole Division)
                </div>
              </div>
            )}

            {/* Attendance Date */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Session Date
              </label>
              <input
                type="date"
                value={attendanceDate}
                onChange={(e) => setAttendanceDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Feedback Message */}
          {message.text && (
            <div
              className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {message.type === 'success' ? (
                <IconCheck className="w-4 h-4 shrink-0" />
              ) : (
                <IconAlert className="w-4 h-4 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {/* Master Toggles & Student List */}
          {loadingRoster ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              Loading student roster...
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <p className="text-xs text-slate-500">
                No students enrolled in this division / batch yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Master 'Mark All Present' and 'Mark All Absent' bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">Quick Controls:</span>
                  <button
                    type="button"
                    onClick={() => handleMarkAll('Present')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors"
                  >
                    Mark All Present
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMarkAll('Absent')}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition-colors"
                  >
                    Mark All Absent
                  </button>
                </div>

                <div className="text-xs font-bold text-slate-600">
                  Attendance Rate:{' '}
                  <span className={percentage >= 75 ? 'text-emerald-600' : 'text-amber-600'}>
                    {percentage}%
                  </span>
                </div>
              </div>

              {/* Individual Student Switch Roster */}
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                {students.map((student) => {
                  const sId = student.ID || student.id;
                  const roll = student.ROLL_NUMBER || student.roll_number;
                  const name = student.NAME || student.name;
                  const batch = student.BATCH || student.batch;
                  const code = student.ACCESS_CODE || student.access_code;
                  const isPresent = attendanceMap[sId] === 'Present';

                  return (
                    <div
                      key={sId}
                      className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                    >
                      {/* Student Info */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-mono font-black text-sm flex items-center justify-center border border-slate-200">
                          {roll}
                        </div>
                        <div>
                          <p className="text-sm font-extrabold text-slate-800">{name}</p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                            <span className="font-mono text-slate-500 font-semibold">{code}</span>
                            <span>&bull;</span>
                            <span className="text-indigo-600 font-bold">Batch {batch}</span>
                          </div>
                        </div>
                      </div>

                      {/* Green/Red Individual Toggle Switch */}
                      <button
                        type="button"
                        onClick={() => toggleStudent(sId)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
                          isPresent
                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                            : 'bg-red-500 hover:bg-red-600 text-white'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isPresent ? 'bg-emerald-200 animate-pulse' : 'bg-red-200'
                          }`}
                        />
                        <span>{isPresent ? 'PRESENT' : 'ABSENT'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Submit Attendance Button */}
              <div className="pt-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitAttendance}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/20 text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <span>Submitting Roll Call...</span>
                  ) : (
                    <>
                      <span>Submit Attendance for {attendanceDate}</span>
                      <IconArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
