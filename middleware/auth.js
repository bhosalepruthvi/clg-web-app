/**
 * middleware/auth.js
 * Session-based role authentication middlewares for College Study Portal.
 */

/**
 * Ensures the requesting user is authenticated as a Teacher.
 */
function requireTeacher(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'teacher') {
    return next();
  }
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Teacher access required. Please log in.'
  });
}

/**
 * Ensures the requesting user is authenticated as a Student.
 */
function requireStudent(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'student') {
    return next();
  }
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Student access required. Please log in.'
  });
}

module.exports = {
  requireTeacher,
  requireStudent
};
