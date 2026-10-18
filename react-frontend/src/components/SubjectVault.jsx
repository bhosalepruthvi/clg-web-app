import React, { useState, useEffect } from 'react';

/**
 * SubjectVault.jsx
 * Displays a grid of subject folders based on the student's exact division and batch.
 * Clicking a folder opens and lists the uploaded Study_Materials for that subject.
 */
export default function SubjectVault({ onSelectFile }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSubject, setOpenSubject] = useState(null); // When a subject folder is opened
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch materials scoped to student's division and batch
  const fetchStudentMaterials = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
      const res = await fetch('/api/materials/student', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (res.ok && data.materials) {
        setMaterials(data.materials);
      } else {
        setError(data.error || 'Failed to fetch study materials.');
      }
    } catch (err) {
      setError('Network connection error. Could not retrieve subject vault.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentMaterials();
  }, []);

  // Group materials by subject_name
  const subjectGroups = materials.reduce((acc, item) => {
    const subject = item.SUBJECT_NAME || item.subject_name || 'General Coursework';
    if (!acc[subject]) {
      acc[subject] = {
        subjectName: subject,
        classType: item.CLASS_TYPE || item.class_type || 'Lecture',
        items: [],
      };
    }
    acc[subject].items.push(item);
    return acc;
  }, {});

  const subjectList = Object.values(subjectGroups);

  // Filter materials in current opened folder
  const currentSubjectData = openSubject ? subjectGroups[openSubject] : null;
  const filteredItems = currentSubjectData
    ? currentSubjectData.items.filter((item) => {
        const title = (item.TITLE || item.title || '').toLowerCase();
        const unit = (item.UNIT_NUMBER || item.unit_number || '').toLowerCase();
        const query = searchQuery.toLowerCase();
        return title.includes(query) || unit.includes(query);
      })
    : [];

  return (
    <div className="space-y-6">
      {/* Vault Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
            Course Repository
          </span>
          <h2 className="text-2xl font-black text-slate-800 mt-2">Subject Vault</h2>
          <p className="text-xs text-slate-500 mt-1">
            Access semester notes, assignment sheets, and lab manuals scoped to your division and batch.
          </p>
        </div>

        {openSubject && (
          <button
            onClick={() => {
              setOpenSubject(null);
              setSearchQuery('');
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors self-start md:self-auto"
          >
            <span>&larr;</span>
            <span>All Subject Folders</span>
          </button>
        )}
      </div>

      {/* Loading & Error States */}
      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 text-sm">
          Loading your subject folders...
        </div>
      ) : error ? (
        <div className="bg-white p-8 rounded-2xl border border-red-200 text-center text-red-600 text-xs font-semibold">
          {error}
        </div>
      ) : subjectList.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <div className="text-4xl">📂</div>
          <h3 className="text-base font-bold text-slate-800">No Course Materials Yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Your teachers have not uploaded any PDFs for your division or batch yet. Check back soon!
          </p>
        </div>
      ) : !openSubject ? (
        /* 1. Subject Folders Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {subjectList.map((group) => {
            const isLab = group.classType === 'Lab/Practical';
            return (
              <div
                key={group.subjectName}
                onClick={() => setOpenSubject(group.subjectName)}
                className="group bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:shadow-xl transition-all duration-200 cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-sm ${
                        isLab
                          ? 'bg-purple-50 text-purple-600 border border-purple-100'
                          : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                      }`}
                    >
                      {isLab ? '🔬' : '📁'}
                    </div>
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full ${
                        isLab
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}
                    >
                      {group.classType}
                    </span>
                  </div>

                  <h3 className="text-lg font-black text-slate-800 group-hover:text-indigo-600 transition-colors leading-snug">
                    {group.subjectName}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {group.items.length} {group.items.length === 1 ? 'file' : 'files'} available
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-indigo-600 group-hover:translate-x-1 transition-transform">
                  <span>Open Folder</span>
                  <span>&rarr;</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* 2. Folder Detail View (List of Materials) */
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          {/* Folder Details Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
                Viewing Folder
              </span>
              <h3 className="text-xl font-black text-slate-900 mt-0.5">{openSubject}</h3>
            </div>

            {/* Search Input */}
            <div className="relative max-w-xs w-full">
              <input
                type="text"
                placeholder="Search unit or topic..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Files List */}
          {filteredItems.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              No materials match your search query.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredItems.map((item) => {
                const id = item.ID || item.id;
                const title = item.TITLE || item.title;
                const unit = item.UNIT_NUMBER || item.unit_number;
                const targetBatch = item.TARGET_BATCH || item.target_batch;
                const teacherName = item.TEACHER_NAME || item.teacher_name;

                return (
                  <div
                    key={id}
                    onClick={() => onSelectFile && onSelectFile(item)}
                    className="group p-5 rounded-xl border border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-white transition-all cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        {unit ? (
                          <span className="px-2.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-extrabold uppercase rounded-full">
                            {unit}
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-slate-200 text-slate-600 text-[10px] font-bold uppercase rounded-full">
                            General
                          </span>
                        )}

                        {targetBatch && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-mono font-bold rounded">
                            Batch {targetBatch}
                          </span>
                        )}
                      </div>

                      <h4 className="text-base font-extrabold text-slate-800 group-hover:text-indigo-600 transition-colors">
                        {title}
                      </h4>

                      {teacherName && (
                        <p className="text-xs text-slate-400 mt-2">
                          Uploaded by: <span className="font-medium text-slate-600">{teacherName}</span>
                        </p>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] font-bold text-indigo-600 flex items-center gap-1 group-hover:underline">
                        <span>📖</span>
                        <span>Read in In-App Viewer</span>
                      </span>
                      <span className="text-xs text-slate-400">&rarr;</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
