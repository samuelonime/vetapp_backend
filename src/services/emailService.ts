export const sendVerificationEmail = async (email: string, _firstName: string): Promise<void> => {
  try {
    // TODO: Implement email sending (Nodemailer, SendGrid, etc.)
    console.log(`Verification email sent to ${email}`);
  } catch (error) {
    console.error('Error sending verification email:', error);
  }
};

export const sendPasswordResetEmail = async (email: string, resetToken: string): Promise<void> => {
  try {
    // TODO: Implement email sending (Nodemailer, SendGrid, etc.)
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    console.log(`Password reset email sent to ${email} with link: ${resetLink}`);
  } catch (error) {
    console.error('Error sending password reset email:', error);
  }
};