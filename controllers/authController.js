const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const User = require('../models/user')
const asyncHandler = require('express-async-handler')
const ErrorHandler = require('../utils/errorHandler')
const sendAuthToken = require('../utils/sendAuthToken')
const sendEmail = require('../utils/sendEmail')
const cookieOptions = require('../config/cookieOptions')
const {
  STATUS_BAD_REQUEST,
  STATUS_UNAUTHORIZED,
  STATUS_OK,
  STATUS_CREATED,
  STATUS_NOT_FOUND,
  STATUS_INTERNAL,
  STATUS_FORBIDDEN,
} = require('../config/statusCodes')

/**
 * @desc Login
 * @route POST /api/v1/auth/login
 * @access public
 */
const loginHandler = asyncHandler(async (req, res, next) => {
  const {username, password} = req.body
  if (!password || !username) {
    return next(new ErrorHandler('All fields are required', STATUS_BAD_REQUEST))
  }

  const foundUser = await User.findOne({username}).select('+password').exec()
  if (!foundUser) {
    return next(new ErrorHandler('Incorrect credentials', STATUS_UNAUTHORIZED))
  }

  const isPasswordMatched = await foundUser.comparePassword(password)
  if (!isPasswordMatched) {
    return next(new ErrorHandler('Incorrect credentials', STATUS_UNAUTHORIZED))
  }

  await sendAuthToken(foundUser, STATUS_OK, res)
})

/**
 * @desc Register
 * @route POST /api/v1/auth/register
 * @access public
 */
const registerHandler = asyncHandler(async (req, res, next) => {
  const {username, name, email, password} = req.body
  if (!username || !name || !password || !email) {
    return next(new ErrorHandler('All fields are required', STATUS_BAD_REQUEST))
  }

  const createdUser = await User.create({
    username,
    name,
    email,
    password,
  })

  sendAuthToken(createdUser, STATUS_CREATED, res)
})

/**
 * @desc Logout
 * @route POST /api/v1/auth/logout
 * @access public
 */
const logoutHandler = asyncHandler(async (req, res, next) => {
  const {jwt: refreshToken} = req.cookies
  if (!refreshToken) {
    return next(new ErrorHandler('You are already logged out', STATUS_BAD_REQUEST))
  }

  const foundUser = await User.findOne({refreshToken}).exec()
  if (foundUser) {
    // Clears the refresh token.
    foundUser.refreshToken = undefined
    // Saves the mutated data.
    await foundUser.save({validateBeforeSave: false})
  }

  // Clears the refresh token from cookies.
  res.clearCookie('jwt', cookieOptions)

  res.status(STATUS_OK).json({
    success: true,
    message: 'You have been logged out',
  })
})

/**
 * @desc Forgot Password
 * @route POST /api/v1/auth/forgot
 * @access public
 */
const forgotPassword = asyncHandler(async (req, res, next) => {
  const {email} = req.body
  if (!email) {
    return next(new ErrorHandler('Email is required', STATUS_BAD_REQUEST))
  }

  const foundUser = await User.findOne({email}).exec()
  if (!foundUser) {
    return next(new ErrorHandler(`User with email (${email}) was not found`, STATUS_NOT_FOUND))
  }

  const resetPasswordToken = foundUser.signResetPasswordToken()
  await foundUser.save({validateBeforeSave: false})

  // Mail content.
  const resetPasswordUrl = `${req.protocol}://${req.get(
    'host'
  )}/account/reset?token=${resetPasswordToken}`
  const message = `Here is the password recovery link:\n\n${resetPasswordUrl}\n\nIf you have not requested this email, then ignore it.`
  const subject = `Password Recovery - Shop by Jozi Bashaj`

  try {
    await sendEmail({email, subject, message})

    res.status(STATUS_OK).json({
      success: true,
      message: `Recovery link sent to: ${foundUser.email}`,
    })
  } catch (error) {
    foundUser.resetPasswordToken = undefined
    foundUser.resetPasswordExpiration = undefined

    await foundUser.save({validateBeforeSave: false})

    return next(new ErrorHandler(`Cannot send email to (${email})`, STATUS_INTERNAL))
  }
})

/**
 * @desc Reset Password
 * @route POST /api/v1/auth/reset/:token
 * @access public
 */
const resetPassword = asyncHandler(async (req, res, next) => {
  const {token: resetPasswordToken} = req.params
  if (!resetPasswordToken) {
    return next(new ErrorHandler('Reset token is required', STATUS_BAD_REQUEST))
  }

  const {password} = req.body
  if (!password) {
    return next(new ErrorHandler('Password is required', STATUS_BAD_REQUEST))
  }

  const hashedResetPasswordToken = crypto
    .createHash('sha256')
    .update(resetPasswordToken)
    .digest('hex')

  const foundUser = await User.findOne({
    resetPasswordToken: hashedResetPasswordToken,
    resetPasswordExpiration: {$gt: Date.now()},
  }).exec()
  if (!foundUser) {
    return next(new ErrorHandler('Reset token has been expired', STATUS_FORBIDDEN))
  }

  foundUser.password = password
  foundUser.resetPasswordToken = undefined
  foundUser.resetPasswordExpiration = undefined
  await foundUser.save()

  sendAuthToken(foundUser, STATUS_OK, res)
})

/**
 * @desc Update Password
 * @route PUT /api/v1/auth/password
 * @access private
 */
const updatePassword = asyncHandler(async (req, res, next) => {
  const userId = req.user.id
  const {password, newPassword} = req.body
  if (!password || !newPassword) {
    return next(new ErrorHandler('All fields are required', STATUS_BAD_REQUEST))
  }

  if (password === newPassword) {
    return next(new ErrorHandler('Cannot use same password', STATUS_BAD_REQUEST))
  }

  const foundUser = await User.findById(userId).select('+password').exec()
  const isPasswordMatched = await foundUser.comparePassword(password)
  if (!isPasswordMatched) {
    return next(new ErrorHandler('Incorrect password', STATUS_FORBIDDEN))
  }

  foundUser.password = newPassword
  await foundUser.save()

  res.status(STATUS_OK).json({
    success: true,
    message: 'Password has been updated',
  })
})

/**
 * @desc Refresh Token
 * @route GET /api/v1/auth/refresh
 * @access private
 */
const getNewAccessToken = asyncHandler(async (req, res, next) => {
  const {jwt: refreshToken} = req.cookies
  if (!refreshToken) {
    return next(new ErrorHandler('Unauthorized', STATUS_UNAUTHORIZED))
  }

  const foundUser = await User.findOne({refreshToken}).exec()
  if (!foundUser) {
    return next(new ErrorHandler('Access expired', STATUS_FORBIDDEN))
  }

  jwt.verify(refreshToken, process.env.JWT_REFRESH_TOKEN_SECRET, (err, decoded) => {
    const userId = foundUser._id.toString()
    const decodedUserId = decoded.id.toString()

    if (err || userId !== decodedUserId) {
      return next(new ErrorHandler('Access expired', STATUS_FORBIDDEN))
    }

    const accessToken = foundUser.signAccessToken()
    res.status(STATUS_OK).json({accessToken})
  })
})

module.exports = {
  loginHandler,
  registerHandler,
  logoutHandler,
  forgotPassword,
  resetPassword,
  updatePassword,
  getNewAccessToken,
}
