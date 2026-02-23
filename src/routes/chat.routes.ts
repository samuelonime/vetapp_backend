import express from 'express';
import {
  getChatMessages,
  sendMessage,
  getConversations,
  markMessagesAsRead,
  getUnreadCount
} from '../controllers/chatController';
import { protect } from '../middleware/auth';
import { uploadChatMedia } from '../middleware/upload';

const router = express.Router();

// Protected routes
router.use(protect);

// Chat routes
router.get('/conversations', getConversations);
router.get('/:appointmentId', getChatMessages);
router.post('/:appointmentId/send', uploadChatMedia, sendMessage);
router.put('/mark-read', markMessagesAsRead);
router.get('/unread/count', getUnreadCount);

export default router;