import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function TeacherLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // Save the returned JWT in localStorage as required
        localStorage.setItem('studyflow_jwt', data.token);
        localStorage.setItem('studyflow_token', data.token);
        localStorage.setItem('studyflow_role', 'teacher');
        localStorage.setItem('studyflow_user', JSON.stringify(data.user));

        // Redirect Teacher to /teacher-dashboard
        navigate('/teacher-dashboard');
      } else {
        setError(data.error || 'Invalid teacher credentials.');
      }
    } catch (err) {
      setError('Network connection failed. Please ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a5f] via-[#162740] to-indigo-950 flex flex-col justify-center items-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-white/20">
        <div className="bg-[#1e3a5f] p-6 text-white text-center">
          <Link to="/" className="text-xs text-blue-200 hover:text-white mb-2 inline-block">&larr; Back to Role Choice</Link>
          <h2 className="text-2xl font-black">Faculty Portal</h2>
          <p className="text-xs text-blue-200 mt-1">Sign in with your faculty email and password</p>
        </div>

        <form onSubmit={handleLogin} className="p-8 space-y-5">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prof@college.edu"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[#1e3a5f] hover:bg-[#284c7a] text-white font-bold rounded-xl shadow-lg shadow-blue-900/30 transition-all text-sm disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In to Dashboard &rarr;'}
          </button>
        </form>
      </div>
    </div>
  );
}
