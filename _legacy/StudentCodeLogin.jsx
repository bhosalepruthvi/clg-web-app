import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function StudentCodeLogin() {
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleCodeLogin = async (e) => {
    e.preventDefault();
    setError('');

    const cleanCode = accessCode.trim().toUpperCase();
    if (!cleanCode) {
      setError('Please enter your access code.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/student/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: cleanCode })
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // Save the returned JWT in localStorage as required
        localStorage.setItem('studyflow_token', data.token);
        localStorage.setItem('studyflow_role', 'student');
        localStorage.setItem('studyflow_student', JSON.stringify(data.student));

        // Redirect Student to /student-dashboard
        navigate('/student-dashboard');
      } else {
        setError(data.error || 'Invalid student access code. Please check with your teacher.');
      }
    } catch (err) {
      setError('Network connection failed. Please ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-[#162740] to-[#1e3a5f] flex flex-col justify-center items-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-white/20">
        <div className="bg-indigo-700 p-6 text-white text-center">
          <Link to="/" className="text-xs text-indigo-200 hover:text-white mb-2 inline-block">&larr; Back to Role Choice</Link>
          <h2 className="text-2xl font-black">Student Access</h2>
          <p className="text-xs text-indigo-200 mt-1">One-click sign in using your unique code</p>
        </div>

        <form onSubmit={handleCodeLogin} className="p-8 space-y-6">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          <div className="text-center">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Enter Your Access Code
            </label>
            <input
              type="text"
              required
              autoFocus
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              placeholder="e.g. FE-E-36"
              className="w-full px-4 py-4 rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-900 text-2xl font-mono font-bold tracking-widest text-center focus:outline-none focus:border-indigo-600 focus:bg-white transition-all placeholder:text-slate-300 uppercase"
            />
            <p className="text-xs text-slate-400 mt-2">
              Your code auto-maps you to your academic year and division.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? 'Verifying Code...' : 'Access My Coursework &rarr;'}
          </button>
        </form>
      </div>
    </div>
  );
}
