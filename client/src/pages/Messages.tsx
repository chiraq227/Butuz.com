import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import {
  MessageCircle, Send, Plus, Search, Lock, ArrowLeft, X, ZoomIn
} from 'lucide-react';
import { usePhotoViewer } from '../components/PhotoViewer';
import {
  ensureFullKeyPair,
  encryptMessage,
  decryptMessage,
} from '../lib/crypto';
import { useSearchParams } from 'react-router-dom';

type ChatMode = 'regular' | 'secret';

interface Conversation {
  user: {
    id: number;
    username: string;
    display_name: string;
    avatar: string;
    has_public_key: boolean;
  };
  last_at: string | null;
  mode?: string;
  last_text?: string | null;
}

interface RegularMsg {
  id: number;
  sender_id: number;
  recipient_id: number;
  content: string;
  created_at: string | null;
}

interface SecretEncryptedMsg {
  id: number;
  sender_id: number;
  recipient_id: number;
  ciphertext: string;
  iv: string;
  created_at: string | null;
}

interface DisplayMsg {
  id: number;
  sender_id: number;
  text: string;
  created_at: string | null;
  // Media support (populated from server or local optimistic preview)
  media_url?: string | null;
  media_type?: 'image' | 'video' | 'voice' | null;
  media_duration?: number | null;
  // Local preview for optimistic messages before server confirms the uploaded url
  _localPreviewUrl?: string;
}

interface RecipientUser {
  id: number;
  username: string;
  display_name: string;
  avatar: string;
  public_key?: string | null;
}

export default function Messages() {
  const { user, token, refreshUnreadMessageCount } = useAuth();
  const currentUserId = user?.id;
  const { openPhoto } = usePhotoViewer();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<ChatMode>('regular');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<RecipientUser | null>(null);

  const didHandleDeepLinkRef = useRef(false);

  const [regularMessages, setRegularMessages] = useState<RegularMsg[]>([]);
  const [displayMessages, setDisplayMessages] = useState<DisplayMsg[]>([]);

  const [secretEncrypted, setSecretEncrypted] = useState<SecretEncryptedMsg[]>([]);
  const [myPrivateJwk, setMyPrivateJwk] = useState<any>(null);
  const [keyReady, setKeyReady] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const [following, setFollowing] = useState<RecipientUser[]>([]);
  const [allUsers, setAllUsers] = useState<RecipientUser[]>([]);

  // Media attachment support (photos, videos, voice messages) — regular chats only for now
  type MessageAttachment = {
    file: File;
    type: 'image' | 'video' | 'voice';
    previewUrl: string;   // object URL for instant preview
    duration?: number;    // seconds (voice)
  };
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const pollRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  useEffect(() => {
    if (!token) return;
    loadConversationsForMode(mode);
  }, [mode, token]);

  useEffect(() => {
    if (!token || !currentUserId) return;

    let cancelled = false;

    async function init() {
      setLoading(true);
      setError('');
      try {
        await loadConversationsForMode('regular');

        const f = await api.getFollowing(token);
        if (!cancelled) {
          setFollowing(f.map((u: any) => ({
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar: u.avatar,
            public_key: u.public_key || null,
          })));
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();

    return () => { cancelled = true; };
  }, [token, currentUserId]);

  async function loadConversationsForMode(m: ChatMode) {
    if (!token) return;
    try {
      if (m === 'regular') {
        const conv = await api.getConversations(token, 'regular');
        setConversations(conv || []);
      } else {
        const conv = await api.getSecretConversations(token);
        setConversations(conv || []);
      }
    } catch (e) {
      console.error('load convos', e);
    }
  }

  async function switchMode(newMode: ChatMode) {
    if (newMode === mode) return;

    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setMode(newMode);
    setSelectedUser(null);
    setDisplayMessages([]);
    setRegularMessages([]);
    setSecretEncrypted([]);
    setError('');
    setInput('');

    if (newMode === 'secret' && !keyReady) {
      await ensureSecretKeys();
    }
  }

  async function ensureSecretKeys() {
    if (!token || !currentUserId) return;

    setKeyLoading(true);
    try {
      const { privateJwk, publicJwk, wasGenerated } = await ensureFullKeyPair(currentUserId);
      setMyPrivateJwk(privateJwk);

      if (wasGenerated || !keyReady) {
        const pubStr = JSON.stringify(publicJwk);
        try {
          await api.uploadPublicKey(pubStr, token);
        } catch (e) {
          console.warn('key upload failed', e);
        }
      }
      setKeyReady(true);
    } catch (e: any) {
      setError('Не удалось подготовить ключи для секретных чатов.');
    } finally {
      setKeyLoading(false);
    }
  }

  async function openChat(other: RecipientUser) {
    if (!token || !currentUserId) return;

    setSelectedUser(other);
    setChatLoading(true);
    setError('');
    setDisplayMessages([]);
    setInput('');

    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    try {
      if (mode === 'regular') {
        const msgs = await api.getMessages(other.id, token);
        setRegularMessages(msgs || []);
        const disp: DisplayMsg[] = (msgs || []).map((m: any) => ({
          id: m.id,
          sender_id: m.sender_id,
          text: m.content || '',
          created_at: m.created_at,
          media_url: m.media_url,
          media_type: m.media_type,
          media_duration: m.media_duration,
        }));
        setDisplayMessages(disp);
        startRegularPoll(other.id);
      } else {
        if (!keyReady || !myPrivateJwk) {
          await ensureSecretKeys();
        }
        if (!myPrivateJwk) {
          setError('Ключи секретного чата не готовы.');
          setChatLoading(false);
          return;
        }

        let theirPub: any = other.public_key;
        if (!theirPub) {
          try {
            const k = await api.getPublicKey(other.id, token);
            theirPub = k.public_key;
            setSelectedUser({ ...other, public_key: theirPub });
          } catch (e: any) {
            setError('У этого пользователя ещё нет ключей для секретных чатов. Попросите открыть «Секретные чаты».');
            setChatLoading(false);
            return;
          }
        }
        if (!theirPub) {
          setError('Получатель не активировал секретные чаты.');
          setChatLoading(false);
          return;
        }

        const enc = await api.getSecretMessages(other.id, token);
        setSecretEncrypted(enc || []);

        const theirPubJwk = typeof theirPub === 'string' ? JSON.parse(theirPub) : theirPub;
        const disp: DisplayMsg[] = [];

        for (const m of (enc || [])) {
          try {
            const text = await decryptMessage(m.ciphertext, m.iv, myPrivateJwk, theirPubJwk);
            disp.push({ id: m.id, sender_id: m.sender_id, text, created_at: m.created_at });
          } catch {
            disp.push({ id: m.id, sender_id: m.sender_id, text: '[невозможно расшифровать]', created_at: m.created_at });
          }
        }
        setDisplayMessages(disp);

        startSecretPoll(other.id, theirPubJwk);
      }
    } catch (e: any) {
      setError(e.message || 'Не удалось открыть чат');
    } finally {
      setChatLoading(false);
      // Immediately refresh global unread count (messages were marked read on the server)
      refreshUnreadMessageCount?.();
    }
  }

  function startSecretPoll(otherId: number, theirPubJwk: any) {
    if (pollRef.current) window.clearInterval(pollRef.current);

    pollRef.current = window.setInterval(async () => {
      if (!token || !myPrivateJwk || !selectedUser) return;
      try {
        const enc = await api.getSecretMessages(otherId, token);
        if (enc && enc.length > secretEncrypted.length) {
          setSecretEncrypted(enc);
          const disp: DisplayMsg[] = [];
          for (const m of enc) {
            try {
              const text = await decryptMessage(m.ciphertext, m.iv, myPrivateJwk, theirPubJwk);
              disp.push({ id: m.id, sender_id: m.sender_id, text, created_at: m.created_at });
            } catch {
              disp.push({ id: m.id, sender_id: m.sender_id, text: '[невозможно расшифровать]', created_at: m.created_at });
            }
          }
          setDisplayMessages(disp);
        }
      } catch {}
    }, 5000) as unknown as number;
  }

  // Live poll for regular (non-secret) chat while open — so incoming messages appear without reload.
  // Mirrors the secret poll pattern (simple length check against closed-over initial; getMessages also marks read server-side).
  function startRegularPoll(otherId: number) {
    if (pollRef.current) window.clearInterval(pollRef.current);

    pollRef.current = window.setInterval(async () => {
      if (!token || !selectedUser || mode !== 'regular') return;
      try {
        const latest = await api.getMessages(otherId, token);
        if (latest && latest.length > regularMessages.length) {
          setRegularMessages(latest);
          const disp: DisplayMsg[] = (latest || []).map((m: any) => ({
            id: m.id,
            sender_id: m.sender_id,
            text: m.content || '',
            created_at: m.created_at,
            media_url: m.media_url,
            media_type: m.media_type,
            media_duration: m.media_duration,
          }));
          setDisplayMessages(disp);
          // Count will drop (getMessages marks incoming as read); keep badge in sync.
          refreshUnreadMessageCount?.();
        }
      } catch {}
    }, 4500) as unknown as number;
  }

  // ====================== MEDIA ATTACHMENT HELPERS (regular chats) ======================
  function revokeAttachmentPreview() {
    if (attachment?.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }

  function removeAttachment(revoke = true) {
    if (revoke) {
      revokeAttachmentPreview();
    }
    setAttachment(null);
    setRecordingTime(0);
  }

  // Gallery: image or video
  function pickFromGallery() {
    if (mode === 'secret') {
      alert('Медиа-вложения пока поддерживаются только в обычных чатах');
      return;
    }
    fileInputRef.current?.click();
  }

  function onGallerySelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      alert('Файл слишком большой (макс ~12 МБ для чатов)');
      e.target.value = '';
      return;
    }

    revokeAttachmentPreview();

    const isVideo = file.type.startsWith('video/');
    const type: 'image' | 'video' = isVideo ? 'video' : 'image';
    const previewUrl = URL.createObjectURL(file);

    setAttachment({ file, type, previewUrl });
    // clear the input so same file can be picked again later
    e.target.value = '';
  }

  // Direct camera (photo). Works great on mobile.
  function takePhoto() {
    if (mode === 'secret') {
      alert('Медиа-вложения пока поддерживаются только в обычных чатах');
      return;
    }
    cameraInputRef.current?.click();
  }

  function onCameraSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    revokeAttachmentPreview();
    const previewUrl = URL.createObjectURL(file);
    setAttachment({ file, type: 'image', previewUrl });
    e.target.value = '';
  }

  // Voice recording using MediaRecorder
  async function toggleVoiceRecording() {
    if (mode === 'secret') {
      alert('Голосовые сообщения пока поддерживаются только в обычных чатах');
      return;
    }

    if (isRecording) {
      // STOP
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (recordingIntervalRef.current) {
        window.clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    // START recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        const previewUrl = URL.createObjectURL(blob);
        const duration = recordingTime;

        revokeAttachmentPreview();
        setAttachment({ file, type: 'voice', previewUrl, duration });

        // stop all tracks
        stream.getTracks().forEach(t => t.stop());
        setRecordingTime(0);
      };

      mr.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime((t) => {
          const next = t + 1;
          if (next >= 120) { // auto stop at 2 minutes
            // fire stop
            if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
            return 120;
          }
          return next;
        });
      }, 1000);
    } catch (e: any) {
      alert('Не удалось получить доступ к микрофону. Разрешите доступ в настройках браузера.');
      console.error('Mic error', e);
    }
  }

  // Cleanup object URLs and recorder on unmount or chat change
  useEffect(() => {
    return () => {
      revokeAttachmentPreview();
      if (recordingIntervalRef.current) window.clearInterval(recordingIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
    };
  }, []);

  // When switching chats, clear pending attachment
  useEffect(() => {
    if (selectedUser) {
      // keep attachment only within the same chat (simple rule)
    } else {
      removeAttachment();
    }
  }, [selectedUser?.id]);

  // Paste from clipboard support (images only)
  const handlePastedImage = (blob: Blob) => {
    // Size limit (same spirit as gallery)
    if (blob.size > 12 * 1024 * 1024) {
      alert('Изображение слишком большое (макс ~12 МБ)');
      return;
    }

    if (attachment) {
      revokeAttachmentPreview();
    }

    // Create a proper File object
    const ext = blob.type.split('/')[1] || 'png';
    const fileName = `clipboard-${Date.now()}.${ext}`;
    const file = new File([blob], fileName, { type: blob.type });

    const previewUrl = URL.createObjectURL(file);

    setAttachment({
      file,
      type: 'image',
      previewUrl,
    });

    // Focus input so user can immediately type a caption
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement | HTMLInputElement>) => {
    if (mode === 'secret') {
      // Give feedback similar to the attachment buttons
      // We don't preventDefault here so normal text paste still works
      // But for images we want to warn
      const hasImage = Array.from(e.clipboardData?.items || []).some(
        (item) => item.type.startsWith('image/')
      ) || (e.clipboardData?.files?.[0]?.type.startsWith('image/') ?? false);

      if (hasImage) {
        e.preventDefault();
        alert('Медиа-вложения пока поддерживаются только в обычных чатах');
      }
      return;
    }

    if (sending || chatLoading || isRecording) return;

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Try direct files (some browsers)
    if (clipboardData.files && clipboardData.files.length > 0) {
      const file = clipboardData.files[0];
      if (file && file.type.startsWith('image/')) {
        e.preventDefault();
        handlePastedImage(file);
        return;
      }
    }

    // 2. Try items (most reliable for clipboard images)
    const items = clipboardData.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handlePastedImage(file);
            return;
          }
        }
      }
    }
  };

  async function handleSend() {
    const text = input.trim();
    const hasAttachment = !!attachment;

    if (!selectedUser || !token || !currentUserId) return;
    if (!text && !hasAttachment) return; // nothing to send

    // Block media in secret mode (E2EE media is significantly more complex)
    if (hasAttachment && mode !== 'regular') {
      alert('Медиа-вложения (фото, видео, голос) пока доступны только в обычных чатах.');
      return;
    }

    setSending(true);

    try {
      if (mode === 'regular') {
        let sent: any;

        if (hasAttachment) {
          // Send with media (FormData). Content/caption is optional.
          sent = await api.sendMessageWithMedia(
            selectedUser.id,
            text,
            attachment.file,
            token,
            attachment.duration
          );

          // For optimistic UI we prefer the local preview (instant) and will use server url on next load.
          const localMedia: Partial<DisplayMsg> = {
            media_url: attachment.previewUrl, // use local blob url for immediate display
            media_type: attachment.type,
            media_duration: attachment.duration,
            _localPreviewUrl: attachment.previewUrl,
          };

          const newMsg: DisplayMsg = {
            id: sent.id || Date.now(),
            sender_id: currentUserId,
            text,
            created_at: sent.created_at || new Date().toISOString(),
            ...localMedia,
          };
          setDisplayMessages((prev) => [...prev, newMsg]);

          // Clear attachment state but do NOT revoke the URL,
          // because the optimistic message is still referencing the local preview blob URL.
          removeAttachment(false);
        } else {
          // Plain text (original fast path)
          sent = await api.sendMessage(selectedUser.id, text, token);
          const newMsg: DisplayMsg = {
            id: sent.id || Date.now(),
            sender_id: currentUserId,
            text,
            created_at: sent.created_at || new Date().toISOString(),
          };
          setDisplayMessages((prev) => [...prev, newMsg]);
        }
      } else {
        // Secret — text only (as before)
        if (!myPrivateJwk) {
          await ensureSecretKeys();
          if (!myPrivateJwk) throw new Error('Ключи не готовы');
        }

        let theirPub = selectedUser.public_key;
        if (!theirPub) {
          const k = await api.getPublicKey(selectedUser.id, token);
          theirPub = k.public_key;
        }
        if (!theirPub) throw new Error('У получателя нет ключа для секретного чата');

        const theirPubJwk = typeof theirPub === 'string' ? JSON.parse(theirPub) : theirPub;

        const { ciphertext, iv } = await encryptMessage(text, myPrivateJwk, theirPubJwk);
        const sent = await api.sendSecretMessage(selectedUser.id, ciphertext, iv, token);

        const newDisp: DisplayMsg = {
          id: sent.id || Date.now(),
          sender_id: currentUserId,
          text,
          created_at: sent.created_at || new Date().toISOString(),
        };
        setDisplayMessages((prev) => [...prev, newDisp]);
      }

      setInput('');
      loadConversationsForMode(mode);

      // Return focus so user can type the next message right away
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (e: any) {
      alert(e.message || 'Не удалось отправить');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } finally {
      setSending(false);
    }
  }

  async function openNewChatPicker() {
    setShowNewChat(true);
    setNewChatSearch('');
    if (allUsers.length === 0 && token) {
      try {
        const users = await api.getUsers(token);
        setAllUsers(users.filter((u: any) => u.id !== currentUserId));
      } catch {}
    }
  }

  async function startNewChat(recipient: RecipientUser) {
    setShowNewChat(false);
    setNewChatSearch('');

    const existing = conversations.find((c) => c.user.id === recipient.id);
    if (existing) {
      await openChat(recipient);
      return;
    }
    await openChat(recipient);
  }

  const filteredNewUsers = (following.length ? following : allUsers)
    .filter((u) =>
      !newChatSearch ||
      u.display_name.toLowerCase().includes(newChatSearch.toLowerCase()) ||
      u.username.toLowerCase().includes(newChatSearch.toLowerCase())
    )
    .slice(0, 15);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  // Live background refresh of the conversations list (every ~14s while visible).
  // This makes new messages from other users appear in the list (and reorder) without page reload or manual action.
  useEffect(() => {
    if (!token) return;
    const iv = setInterval(() => {
      if (!document.hidden) {
        loadConversationsForMode(mode).catch(() => {});
      }
    }, 14000);
    return () => clearInterval(iv);
  }, [token, mode]);

  // Support deep linking from notifications / toasts: ?openUser=123&mode=secret
  // Only process once per mount / param change
  useEffect(() => {
    const openUserId = searchParams.get('openUser');
    const openMode = (searchParams.get('mode') as ChatMode) || 'regular';

    if (!openUserId || didHandleDeepLinkRef.current || !token || !currentUserId) return;

    const targetId = parseInt(openUserId, 10);
    if (!targetId) return;

    didHandleDeepLinkRef.current = true;

    const openTarget = async () => {
      try {
        // Find if we already have the user in conversations, otherwise fetch
        const existing = conversations.find((c) => c.user.id === targetId);

        let recipient: RecipientUser;

        if (existing) {
          recipient = {
            id: existing.user.id,
            username: existing.user.username,
            display_name: existing.user.display_name,
            avatar: existing.user.avatar,
            public_key: existing.user.has_public_key ? 'present' : null,
          };
        } else {
          const users = await api.getUsers(token);
          const found = users.find((u: any) => u.id === targetId);
          if (!found) return;
          recipient = {
            id: found.id,
            username: found.username,
            display_name: found.display_name,
            avatar: found.avatar,
            public_key: found.public_key || null,
          };
        }

        if (openMode !== mode) {
          await switchMode(openMode);
        }

        // Small delay to allow mode state to settle
        setTimeout(() => {
          openChat(recipient);
          setSearchParams({}, { replace: true });
        }, 80);
      } catch (e) {
        console.warn('Failed to open chat from URL param', e);
      }
    };

    openTarget();
  }, [searchParams, token, currentUserId]);  // conversations not needed in deps; we read latest inside

  // Auto-focus the composer input whenever a chat is opened (or finishes loading).
  // This makes the flow feel snappy: click a conversation → ready to type.
  useEffect(() => {
    if (selectedUser && !chatLoading) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
      }, 70);
      return () => clearTimeout(t);
    }
  }, [selectedUser?.id, chatLoading]);

  if (loading) {
    return (
      <div className="h-[calc(100dvh-4rem)] md:h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 pb-16 md:pb-0">
        <div className="animate-spin h-8 w-8 border-b-2 border-indigo-600 rounded-full" />
      </div>
    );
  }

  const isSecret = mode === 'secret';

  return (
    <div className="h-[calc(100dvh-4rem)] md:h-[calc(100vh-4rem)] flex flex-col bg-slate-50 messages-page pb-16 md:pb-0 w-full overflow-x-hidden">
      <div className="flex items-center justify-between border-b bg-white px-2 sm:px-4 py-2 flex-shrink-0 overflow-x-hidden gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
              <MessageCircle className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm sm:text-lg tracking-tight leading-none">Сообщения</div>
            </div>
          </div>

          {/* Compact mode tabs */}
          <div className="flex rounded-full border border-slate-200 bg-slate-100 p-0.5 text-[10px] sm:text-xs messages-mode-tabs flex-shrink-0">
            <button
              onClick={() => switchMode('regular')}
              className={`messages-mode-tab flex items-center gap-1 px-2 py-0.5 rounded-full transition ${!isSecret ? 'is-active bg-white shadow text-slate-900' : 'text-slate-600'}`}
            >
              <MessageCircle className="w-3 h-3" />
              <span>Обыч.</span>
            </button>
            <button
              onClick={() => switchMode('secret')}
              className={`messages-mode-tab flex items-center gap-1 px-2 py-0.5 rounded-full transition ${isSecret ? 'is-active bg-white shadow text-slate-900' : 'text-slate-600'}`}
            >
              <Lock className="w-3 h-3" />
              <span>Секр.</span>
            </button>
          </div>
        </div>

        <button
          onClick={openNewChatPicker}
          className="flex items-center gap-1 rounded-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 px-2.5 py-1 text-xs font-medium text-white transition flex-shrink-0 whitespace-nowrap"
        >
          <Plus className="w-3 h-3" />
          <span>Новый</span>
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm flex-shrink-0">{error}</div>
      )}

      {/* Main chat area - full width, two pane (mobile: stack, show list OR chat) */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Conversations sidebar / list — Telegram style */}
        <div className={`${selectedUser ? 'hidden md:flex' : 'flex'} w-full md:w-80 border-r bg-white flex flex-col flex-shrink-0`}>
          <div className="px-4 py-3 text-sm font-semibold border-b flex items-center bg-white">
            {isSecret ? 'Секретные чаты' : 'Чаты'}
            <span className="ml-auto text-xs text-slate-400">{conversations.length}</span>
          </div>

          <div className="overflow-y-auto flex-1">
            {conversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">
                Нет чатов
              </div>
            ) : (
              conversations.map((c) => {
                const active = selectedUser?.id === c.user.id;
                const lastText = c.last_text || (isSecret ? '• • •' : '');
                const timeStr = c.last_at ? new Date(c.last_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
                return (
                  <button
                    key={c.user.id}
                    onClick={() => openChat(c.user as any)}
                    className={`w-full px-3 py-3 flex items-start gap-3 text-left hover:bg-slate-50 border-b border-slate-100 transition ${active ? 'bg-slate-50' : ''}`}
                  >
                    <Avatar src={c.user.avatar} alt={c.user.username} size="md" />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-slate-900 truncate">{c.user.display_name}</div>
                        {timeStr && <div className="ml-auto text-[11px] text-slate-400 tabular-nums flex-shrink-0">{timeStr}</div>}
                      </div>
                      <div className="text-sm text-slate-500 truncate mt-0.5 pr-8">
                        {lastText || 'Нет сообщений'}
                      </div>
                    </div>
                    {/* Unread badge (structure per spec; count not per-chat in current data) */}
                    <div className="w-5 flex-shrink-0 pt-1">
                      {/* e.g. <span className="ml-auto inline-block min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-600 text-white text-[10px] text-center">3</span> */}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat pane - takes remaining full width (on mobile only show when a chat is selected) */}
        <div className={`${!selectedUser ? 'hidden md:flex' : 'flex'} flex-1 flex flex-col min-w-0 bg-white`}>
          {!selectedUser ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-10 text-slate-400">
              <MessageCircle className="w-12 h-12 mb-4 text-slate-200" />
              <div className="text-base">Выберите чат</div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="h-14 border-b px-5 flex items-center gap-3 bg-white flex-shrink-0">
                <button
                  onClick={() => {
                    setSelectedUser(null);
                    setDisplayMessages([]);
                    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
                  }}
                  className="lg:hidden mr-1 p-1 text-slate-400 hover:text-slate-600"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <Avatar src={selectedUser.avatar} alt={selectedUser.username} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900">{selectedUser.display_name}</div>
                  <div className="text-xs text-slate-500">@{selectedUser.username}</div>
                </div>

                {isSecret && <Lock className="w-4 h-4 text-emerald-600" />}
              </div>

              {/* Messages area */}
              <div className="messages-chat-area flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 space-y-4 bg-slate-50 w-full">
                {chatLoading && (
                  <div className="text-center py-8 text-sm text-slate-500">Загрузка…</div>
                )}

                {!chatLoading && displayMessages.length === 0 && (
                  <div className="text-center py-12 text-slate-400 text-sm">
                    Нет сообщений
                  </div>
                )}

                {displayMessages.map((m, idx) => {
                  const isMine = m.sender_id === currentUserId;
                  const mediaUrl = m._localPreviewUrl || m.media_url;
                  const hasMedia = !!mediaUrl && m.media_type;

                  return (
                    <div key={m.id || idx} className={`flex ${isMine ? 'justify-end' : ''}`}>
                      <div className={`max-w-[82%] md:max-w-[78%] overflow-hidden rounded-2xl shadow-sm ${isMine
                          ? 'bg-indigo-600 text-white rounded-br-md'
                          : 'bg-white border border-slate-200 text-slate-700 rounded-bl-md'
                        }`}>
                        {/* Media content */}
                        {hasMedia && (
                          <div className="relative">
                            {m.media_type === 'image' && (
                              <div 
                                className="relative group cursor-pointer"
                                onClick={() => openPhoto({ 
                                  src: mediaUrl!, 
                                  alt: 'Фото в сообщении', 
                                  type: 'message' 
                                })}
                              >
                                <img
                                  src={mediaUrl!}
                                  alt="photo"
                                  className="max-h-[260px] w-full object-cover transition-transform group-hover:scale-[1.02]"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                  <ZoomIn className="w-3 h-3" /> Открыть
                                </div>
                              </div>
                            )}
                            {m.media_type === 'video' && (
                              <video
                                src={mediaUrl!}
                                controls
                                className="max-h-[260px] w-full bg-black"
                              />
                            )}
                            {m.media_type === 'voice' && (
                              <div className={`flex items-center gap-3 px-4 py-3 ${isMine ? 'bg-indigo-700/60' : 'bg-slate-50'}`}>
                                <span className="text-xl">🎤</span>
                                <audio src={mediaUrl!} controls className="flex-1 h-9" />
                                {m.media_duration != null && (
                                  <span className={`text-[10px] tabular-nums ${isMine ? 'text-indigo-200' : 'text-slate-500'}`}>
                                    {m.media_duration}s
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Text (caption or regular message) */}
                        {m.text && (
                          <div className={`px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap break-words ${hasMedia ? 'pt-2' : ''}`}>
                            {m.text}
                          </div>
                        )}

                        {/* Timestamp */}
                        <div className={`px-4 pb-2 text-[10px] opacity-70 ${hasMedia && !m.text ? 'pt-1' : ''} ${isMine ? 'text-indigo-200' : 'text-slate-400'}`}>
                          {m.created_at ? new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer */}
              <div 
                className="p-4 border-t bg-white flex-shrink-0" 
                onPaste={handlePaste}
              >
                {/* Attachment preview bar */}
                {attachment && (
                  <div className="mb-3 flex items-center gap-2 sm:gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-2 pr-3 overflow-hidden">
                    <div className="flex-1 min-w-0 flex items-center gap-2 sm:gap-3">
                      {attachment.type === 'image' && (
                        <img src={attachment.previewUrl} alt="preview" className="h-9 w-9 sm:h-12 sm:w-12 rounded-xl object-cover border flex-shrink-0" />
                      )}
                      {attachment.type === 'video' && (
                        <video src={attachment.previewUrl} className="h-9 w-12 sm:h-12 sm:w-16 rounded-xl object-cover border bg-black flex-shrink-0" muted />
                      )}
                      {attachment.type === 'voice' && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                            <span className="text-base sm:text-lg">🎤</span>
                          </div>
                          <audio src={attachment.previewUrl} controls className="h-8 sm:h-9" />
                          {attachment.duration != null && (
                            <span className="text-xs tabular-nums text-slate-500">{attachment.duration}s</span>
                          )}
                        </div>
                      )}
                      <div className="min-w-0 text-xs sm:text-sm">
                        <div className="font-medium truncate">
                          {attachment.type === 'voice' ? 'Голосовое сообщение' : attachment.file.name}
                        </div>
                        <div className="text-[9px] sm:text-[10px] text-slate-500">
                          {(attachment.file.size / 1024 / 1024).toFixed(1)} МБ
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={removeAttachment}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-red-500 flex-shrink-0"
                      title="Удалить вложение"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Recording indicator */}
                {isRecording && (
                  <div className="mb-3 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-red-700">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-3 w-3">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
                      </span>
                      <span className="font-medium">Запись голоса</span>
                    </div>
                    <span className="tabular-nums font-mono text-sm">{recordingTime}s / 120s</span>
                    <button onClick={toggleVoiceRecording} className="ml-auto rounded-full bg-red-600 px-3 py-0.5 text-xs font-semibold text-white">Остановить</button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {/* Text input */}
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    onPaste={handlePaste}
                    placeholder={isRecording ? 'Говорите…' : 'Сообщение'}
                    className="flex-1 rounded-full border border-slate-200 bg-white px-5 py-3 text-[15px] focus:outline-none focus:border-indigo-300 disabled:bg-slate-100"
                    disabled={chatLoading || isRecording}
                  />

                  {/* Attachment actions (only for regular chats) */}
                  {!isSecret && (
                    <>
                      <button
                        type="button"
                        onClick={toggleVoiceRecording}
                        disabled={sending || chatLoading || !!attachment}
                        className={`rounded-full p-2 transition ${isRecording ? 'bg-red-100 text-red-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'} disabled:opacity-50`}
                        title={isRecording ? 'Остановить запись' : 'Записать голосовое сообщение'}
                      >
                        🎤
                      </button>

                      <button
                        type="button"
                        onClick={pickFromGallery}
                        disabled={sending || chatLoading || !!attachment}
                        className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                        title="Выбрать фото или видео из галереи"
                      >
                        📎
                      </button>

                      <button
                        type="button"
                        onClick={takePhoto}
                        disabled={sending || chatLoading || !!attachment}
                        className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                        title="Сфотографировать"
                      >
                        📷
                      </button>
                    </>
                  )}

                  {/* Send button */}
                  <button
                    onClick={handleSend}
                    disabled={(!input.trim() && !attachment) || sending || chatLoading || isRecording}
                    className="rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-5 py-2 flex items-center gap-1.5 font-medium transition active:scale-[0.985]"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline text-sm">Отправить</span>
                  </button>
                </div>

                {/* Hidden file inputs for gallery + camera */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={onGallerySelected}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onCameraSelected}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* New chat modal */}
      {showNewChat && (
        <div className="fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-16 p-4" onClick={() => setShowNewChat(false)}>
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="font-semibold">Новый чат {isSecret && '(секретный)'}</div>
              <button onClick={() => setShowNewChat(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="p-4">
              <div className="relative mb-3">
                <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                <input
                  value={newChatSearch}
                  onChange={(e) => setNewChatSearch(e.target.value)}
                  placeholder="Поиск среди подписок и пользователей"
                  className="w-full pl-10 border border-slate-200 rounded-2xl py-2.5 text-sm"
                />
              </div>

              {filteredNewUsers.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">Никого не найдено</div>
              ) : (
                <div className="max-h-[320px] overflow-auto space-y-1 -mx-1">
                  {filteredNewUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => startNewChat(u)}
                      className="w-full flex gap-3 items-center px-3 py-2 rounded-2xl hover:bg-slate-50 text-left"
                    >
                      <Avatar src={u.avatar} alt={u.username} size="sm" />
                      <div>
                        <div className="font-medium">{u.display_name}</div>
                        <div className="text-xs text-slate-500">@{u.username}</div>
                      </div>
                      {isSecret && !u.public_key && (
                        <div className="ml-auto text-[10px] text-amber-600">нужен ключ</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3 text-xs text-slate-400 bg-slate-50 border-t">
              {isSecret ? 'Секретный чат' : 'Обычный чат'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
