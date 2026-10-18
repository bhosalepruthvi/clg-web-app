import React, { useState, useEffect } from 'react';

export default function ClassManager({ onClassCreated }) {
  // Form State
  const [academicYear, setAcademicYear] = useState('FE');
  const [branch, setBranch] = useState('Common');
  const [division, setDivision] = useState('A');
  const [subjectName, setSubjectName] = useState('');
  const [isLab, setIsLab] = useState(false);
  const [batchTags, setBatchTags] = useState([]);
  const [batchInput, setBatchInput] = useState('');

  // Status & List State
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Academic year change logic
  const handleYearChange = (year) => {
    setAcademicYear(year);
    if (year === 'FE') {
      // Crucial requirement: If 'FE' is selected, automatically hide the Branch dropdown and set value to 'Common'
      setBranch('Common');
    } else if (branch === 'Common') {
      // Reset to default branch when switching away from FE
      setBranch('CE');
    }
  };

  // Pre-fill default batch tags when lab is toggled
  const handleLabToggle = (checked) => {
    setIsLab(checked);
    if (checked && batchTags.length === 0) {
      setBatchTags([`${division}1`, `${division}2`, `${division}3`]);
    }
  };

  // Add batch tag
  const handleAddBatch = (e) => {
    e.preventDefault();
    const tag = batchInput.trim().toUpperCase();
    if (tag && !batchTags.includes(tag)) {
      setBatchTags([...batchTags, tag]);
      setBatchInput('');
    }
  };

  // Remove batch tag
  const handleRemoveBatch = (tagToRemove) => {
    setBatchTags(batchTags.filter((t) => t !== tagToRemove));
  };

  // Fetch created classes
  const fetchClasses = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
      const res = await fetch('/api/classes', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.classes) {
        setClasses(data.classes);
      }
    } catch (err) {
      console.error('Failed to load classes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  // Submit class creation
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    if (!subjectName.trim()) {
      setMessage({ text: 'Please enter a Subject Name.', type: 'error' });
      return;
    }

    if (isLab && batchTags.length === 0) {
      setMessage({ text: 'Please add at least one Batch tag for a Lab class.', type: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
      const payload = {
        academic_year: academicYear,
        branch: academicYear === 'FE' ? 'Common' : branch,
        division,
        subject_name: subjectName.trim(),
        class_type: isLab ? 'Lab/Practical' : 'Lecture',
        batch_names: isLab ? batchTags : []
      };

      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ text: 'Class created successfully!', type: 'success' });
        setSubjectName('');
        setIsLab(false);
        setBatchTags([]);
        fetchClasses();
        if (onClassCreated) onClassCreated();
      } else {
        setMessage({ text: data.error || 'Failed to create class.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Network error. Please try again.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-blue-600 uppercase tracking-widest bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
            Course Management
          </span>
          <h2 className="text-2xl font-black text-slate-800 mt-2">Class Manager</h2>
          <p className="text-xs text-slate-500 mt-1">
            Configure lecture sections and lab practical batches for your department.
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 font-semibold block">Active Classes</span>
          <span className="text-2xl font-black text-[#1e3a5f]">{classes.length}</span>
        </div>
      </div>

      {/* Creation Form Card */}
      <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
          <span>➕</span> Create New Class or Lab
        </h3>

        {message.text && (
          <div
            className={`p-4 rounded-xl text-xs font-semibold mb-6 flex items-center gap-2 ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <span>{message.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            
            {/* 1. Academic Year Dropdown */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Academic Year
              </label>
              <select
                value={academicYear}
                onChange={(e) => handleYearChange(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              >
                <option value="FE">First Year (FE)</option>
                <option value="SE">Second Year (SE)</option>
                <option value="TE">Third Year (TE)</option>
                <option value="BE">Final Year (BE)</option>
              </select>
            </div>

            {/* 2. Branch Dropdown (Crucial logic: Hide if FE, default to 'Common') */}
            {academicYear !== 'FE' ? (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Branch
                </label>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                >
                  <option value="CE">Computer Engineering (CE)</option>
                  <option value="IT">Information Technology (IT)</option>
                  <option value="AIDS">AI & Data Science (AIDS)</option>
                  <option value="EXTC">Electronics & Telecom (EXTC)</option>
                  <option value="MECH">Mechanical (MECH)</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Branch (Auto-assigned)
                </label>
                <div className="px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 text-sm font-semibold">
                  Common Curriculum
                </div>
              </div>
            )}

            {/* 3. Division Dropdown */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Division
              </label>
              <select
                value={division}
                onChange={(e) => {
                  setDivision(e.target.value);
                  if (isLab) {
                    setBatchTags([`${e.target.value}1`, `${e.target.value}2`, `${e.target.value}3`]);
                  }
                }}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              >
                {['A', 'B', 'C', 'D', 'E', 'F'].map((div) => (
                  <option key={div} value={div}>
                    Division {div}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Subject Input */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Subject Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Data Structures"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Checkbox: Is this a Lab? */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isLab}
                onChange={(e) => handleLabToggle(e.target.checked)}
                className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-bold text-slate-800">Is this a Lab session?</span>
                <p className="text-xs text-slate-500">
                  Enable sub-batches (e.g. {division}1, {division}2) for targeted lab materials and attendance roll calls.
                </p>
              </div>
            </label>

            {/* Dynamic Input for Batch Tags (like E1, E2, E3) */}
            {isLab && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Sub-Batches Assigned:
                </label>

                {/* Tags preview */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {batchTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-100 text-indigo-800 rounded-lg text-xs font-bold border border-indigo-200"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveBatch(tag)}
                        className="hover:text-red-600 font-black text-sm leading-none"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  {batchTags.length === 0 && (
                    <span className="text-xs text-amber-600 font-medium">
                      No batches added yet. Type a batch name below.
                    </span>
                  )}
                </div>

                {/* Add new tag field */}
                <div className="flex gap-2 max-w-sm">
                  <input
                    type="text"
                    value={batchInput}
                    onChange={(e) => setBatchInput(e.target.value.toUpperCase())}
                    placeholder={`e.g. ${division}4`}
                    className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold uppercase focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddBatch}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    + Add Batch
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-[#1e3a5f] hover:bg-[#284c7a] text-white font-bold rounded-xl shadow-md transition-all text-sm disabled:opacity-50"
          >
            {submitting ? 'Creating Class...' : 'Save & Publish Class'}
          </button>
        </form>
      </div>

      {/* Existing Classes List */}
      <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center justify-between">
          <span>📚 Your Active Classes</span>
          <button
            onClick={fetchClasses}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
          >
            Refresh
          </button>
        </h3>

        {loading ? (
          <p className="text-xs text-slate-400 py-4">Loading your classes...</p>
        ) : classes.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            No classes created yet. Fill out the form above to get started!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {classes.map((cls) => {
              const classId = cls.ID || cls.id;
              const year = cls.ACADEMIC_YEAR || cls.academic_year;
              const br = cls.BRANCH || cls.branch;
              const div = cls.DIVISION || cls.division;
              const sub = cls.SUBJECT_NAME || cls.subject_name;
              const type = cls.CLASS_TYPE || cls.class_type;
              const batches = cls.batches || [];

              return (
                <div
                  key={classId}
                  className="p-4 rounded-xl border border-slate-200 hover:border-blue-300 bg-slate-50/50 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                          type === 'Lab/Practical'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {type}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-500">
                        {year} &bull; {br} &bull; Div {div}
                      </span>
                    </div>

                    <h4 className="text-base font-extrabold text-slate-800 mt-2">{sub}</h4>

                    {type === 'Lab/Practical' && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        <span className="text-[10px] text-slate-400 font-semibold mr-1">Batches:</span>
                        {batches.map((b) => (
                          <span
                            key={b.ID || b.id || b.batch_name}
                            className="px-2 py-0.5 bg-white border border-slate-200 text-slate-700 rounded text-[10px] font-bold font-mono"
                          >
                            {b.BATCH_NAME || b.batch_name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
