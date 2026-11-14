import { appFetch } from '../lib/transport';
import { authFetch as fetch } from '../lib/api';
import React, { useState, useEffect } from 'react';

import { IconMegaphone, IconPin, IconTrash } from './icons';

const YEARS = ['FE', 'SE', 'TE', 'BE'];
const DIVISIONS = ['A', 'B', 'C', 'D', 'E'];
const BRANCHES = ['CE', 'IT', 'MECH', 'ENTC', 'Civil'];

/**
 * NoticeBoard.jsx
 * Teacher tab: post announcements targeted to a year/branch/division
 * (optional lab batch), review them pinned-first, and delete.
 */
export default function NoticeBoard() {
  const [academicYear, setAcademicYear] = useState('SE');
  const [branch, setBranch] = useState('CE');
  const [division, setDivision] = useState('A');
  const [batch, setBatch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPinned, setIsPinned] = useState(false);

  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const getToken = () =>
    localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');

  const showMessage = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  const fetchNotices = async () => {
    try {
      const res = await appFetch('/api/notices/teacher', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok && data.notices) {
        setNotices(data.notices);
      }
    } catch (err) {
      console.error('Failed to load notices', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleYearChange = (year) => {
    setAcademicYear(year);
    if (year === 'FE') {
      setBranch('Common');
    } else if (branch === 'Common') {
      setBranch('CE');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      showMessage('Title and message are required.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await appFetch('/api/notices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          academic_year: academicYear,
          branch,
          division,
          batch: batch.trim() || undefined,
          title: title.trim(),
          body: body.trim(),
          is_pinned: isPinned,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showMessage('Notice posted.', 'success');
        setTitle('');
        setBody('');
        setBatch('');
        setIsPinned(false);
        await fetchNotices();
      } else {
        showMessage(data.error || 'Failed to post notice.', 'error');
      }
    } catch (err) {
      showMessage('Network error. Could not post notice.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this notice? Students will no longer see it.')) return;
    try {
      const res = await appFetch(`/api/notices/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) {
        showMessage('Notice deleted.', 'success');
        setNotices((prev) => prev.filter((n) => (n.ID || n.id) !== id));
      } else {
        showMessage(data.error || 'Failed to delete notice.', 'error');
      }
    } catch (err) {
      showMessage('Network error. Could not delete notice.', 'error');
    }
  };

  const val = (r, k) => r[k] ?? r[k.toUpperCase()];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Post form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 p-6 space-y-4"
      >
        <h3 className="text-lg font-extrabold text-indigo-900">Post a Notice</h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Year</span>
            <select
              value={academicYear}
              onChange={(e) => handleYearChange(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Branch</span>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={academicYear === 'FE'}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
            >
              {academicYear === 'FE' ? (
                <option value="Common">Common</option>
              ) : (
                BRANCHES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Division</span>
            <select
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {DIVISIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Batch (optional)</span>
            <input
              type="text"
              value={batch}
              onChange={(e) => setBatch(e.target.value.toUpperCase())}
              placeholder="e.g. A1"
              maxLength={10}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>
        <p className="text-[11px] text-slate-400">
          Leave batch empty to reach the whole division. Fill it to target one lab batch only.
        </p>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Notice title"
          maxLength={200}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the announcement…"
          rows={4}
          maxLength={2000}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />

        <div className="flex items-center justify-between flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
            />
            <span className="flex items-center gap-1.5">
              <IconPin className="w-3.5 h-3.5 text-amber-500" /> Pin to top
            </span>
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Posting…' : 'Post Notice'}
          </button>
        </div>

        {message.text && (
          <p
            className={`text-sm font-semibold ${
              message.type === 'error' ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {message.text}
          </p>
        )}
      </form>

      {/* Notice list */}
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400 font-semibold">Loading notices…</p>
        ) : notices.length === 0 ? (
          <div className="bg-white rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-400 flex items-center justify-center">
              <IconMegaphone className="w-6 h-6" />
            </div>
            <p className="text-sm font-extrabold text-indigo-900">No notices yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Post your first announcement using the form above.
            </p>
          </div>
        ) : (
          notices.map((n) => {
            const id = val(n, 'id');
            const pinned = Number(val(n, 'is_pinned')) === 1;
            const targetBatch = val(n, 'batch');
            const createdAt = val(n, 'created_at');
            return (
              <div
                key={id}
                className={`bg-white rounded-2xl border shadow-sm shadow-indigo-100 p-5 flex items-start justify-between gap-4 ${
                  pinned ? 'border-amber-300' : 'border-indigo-100'
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {pinned && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-extrabold uppercase rounded-full flex items-center gap-1">
                        <IconPin className="w-3 h-3" /> Pinned
                      </span>
                    )}
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold uppercase rounded-full">
                      {val(n, 'academic_year')} · {val(n, 'branch')} · Div {val(n, 'division')}
                      {targetBatch ? ` · Batch ${targetBatch}` : ''}
                    </span>
                  </div>
                  <h4 className="text-base font-extrabold text-indigo-900 break-words">
                    {val(n, 'title')}
                  </h4>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap break-words">
                    {val(n, 'body')}
                  </p>
                  {createdAt && (
                    <p className="text-[11px] text-slate-400 font-medium">
                      Posted {new Date(createdAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(id)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-red-500 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 transition-colors flex items-center gap-1.5"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
