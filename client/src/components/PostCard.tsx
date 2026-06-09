import { useState, useEffect } from 'react';
import { Heart, Trash2, MoreHorizontal, Bookmark, BookmarkCheck, MessageCircle, ZoomIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import Avatar from './Avatar';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { usePhotoViewer } from './PhotoViewer';

interface Post {
  id: number;
  content: string;
  image?: string | null;
  created_at: string;
  user: {
    id: number;
    username: string;
    display_name: string;
    avatar: string;
  };
  like_count: number;
  user_liked: boolean;
  is_bookmarked?: boolean;
  comment_count?: number;
}

interface PostCardProps {
  post: Post;
  onDelete?: (postId: number) => void;
  onLikeChange?: (postId: number, liked: boolean, count: number) => void;
  onBookmarkChange?: (postId: number, bookmarked: boolean) => void;
  allowPinning?: boolean;
  onPinChange?: (postId: number, isPinned: boolean) => void;
}

export default function PostCard({ post, onDelete, onLikeChange, onBookmarkChange, allowPinning = true, onPinChange }: PostCardProps) {
  const { user, token } = useAuth();
  const { openPhoto } = usePhotoViewer();
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [isLiked, setIsLiked] = useState(post.user_liked);
  const [isLiking, setIsLiking] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(!!post.is_bookmarked);
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Pin
  const [isPinned, setIsPinned] = useState(!!post.is_pinned);
  const [pinning, setPinning] = useState(false);

  // Comments
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentActionLoading, setCommentActionLoading] = useState(false);
  const [localCommentCount, setLocalCommentCount] = useState(post.comment_count || 0);

  useEffect(() => {
    setIsPinned(!!post.is_pinned);
    setLocalCommentCount(post.comment_count || 0);
  }, [post.is_pinned, post.comment_count]);

  const isOwnPost = user?.id === post.user.id;

  const handleLike = async () => {
    if (!token || isLiking) return;

    setIsLiking(true);
    try {
      const res = await api.toggleLike(post.id, token);
      setIsLiked(res.liked);
      setLikeCount(res.like_count);
      onLikeChange?.(post.id, res.liked, res.like_count);
    } catch (e) {
      console.error('Like failed', e);
    } finally {
      setIsLiking(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !confirm('Удалить этот пост?')) return;
    try {
      await api.deletePost(post.id, token);
      onDelete?.(post.id);
    } catch (e) {
      alert('Не удалось удалить пост');
    }
  };

  const handleBookmark = async () => {
    if (!token || isBookmarking) return;
    setIsBookmarking(true);
    try {
      const res = await api.toggleBookmark(post.id, token);
      const newState = res.bookmarked;
      setIsBookmarked(newState);
      onBookmarkChange?.(post.id, newState);
    } catch (e) {
      console.error('Bookmark failed', e);
    } finally {
      setIsBookmarking(false);
    }
  };

  const handlePin = async () => {
    if (!token || pinning) return;
    setPinning(true);
    try {
      const res = await api.pinPost(post.id, token);
      setIsPinned(res.is_pinned);
      onPinChange?.(post.id, res.is_pinned);
      setShowMenu(false);
    } catch (e) {
      alert('Не удалось закрепить пост');
    } finally {
      setPinning(false);
    }
  };

  // Comments
  const toggleComments = async () => {
    const next = !showComments;
    setShowComments(next);
    if (next && comments.length === 0) {
      setLoadingComments(true);
      try {
        const data = await api.getComments(post.id, token || undefined);
        setComments(data);
      } catch (e) {
        console.error('Failed to load comments');
      } finally {
        setLoadingComments(false);
      }
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !token) return;
    setCommentActionLoading(true);
    try {
      const created = await api.createComment(post.id, newComment.trim(), token);
      setComments(prev => {
        const updated = [created, ...prev];
        return updated.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
      });
      setNewComment('');
      setLocalCommentCount(c => c + 1);
    } catch (e) {
      alert('Не удалось добавить комментарий');
    } finally {
      setCommentActionLoading(false);
    }
  };

  const handleLikeComment = async (comment: any) => {
    if (!token || commentActionLoading) return;
    setCommentActionLoading(true);
    try {
      const res = await api.toggleCommentLike(comment.id, token);
      setComments(prev => {
        const updated = prev.map(c =>
          c.id === comment.id
            ? { ...c, user_liked: res.liked, like_count: res.like_count }
            : c
        );
        return updated.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
      });
    } catch (e) {
      console.error('Like comment failed');
    } finally {
      setCommentActionLoading(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!token || !confirm('Удалить комментарий?')) return;
    setCommentActionLoading(true);
    try {
      await api.deleteComment(commentId, token);
      setComments(prev => prev.filter(c => c.id !== commentId));
      setLocalCommentCount(c => Math.max(0, c - 1));
    } catch (e) {
      alert('Не удалось удалить комментарий');
    } finally {
      setCommentActionLoading(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин. назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч. назад`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="post-card bg-white border border-slate-200 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <Link to={`/profile/${post.user.username}`} className="flex items-center gap-3 group">
          <Avatar src={post.user.avatar} alt={post.user.username} />
          <div>
            <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
              {post.user.display_name}
            </div>
            <div className="text-sm text-slate-500">@{post.user.username}</div>
          </div>
        </Link>

        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>{timeAgo(post.created_at)}</span>
          {isPinned && (
            <span className="px-1.5 py-0.5 text-[10px] bg-yellow-100 text-yellow-700 rounded">📌 Закреплено</span>
          )}

          {isOwnPost && allowPinning && (
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-2 -m-1 hover:bg-slate-100 rounded-full min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Действия с постом"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-1 bg-white border rounded-2xl shadow py-1 w-40 z-10">
                  <button
                    onClick={handlePin}
                    disabled={pinning}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 text-left"
                  >
                    {isPinned ? '📌 Открепить пост' : '📌 Закрепить пост'}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" /> Удалить пост
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="text-[15px] leading-relaxed text-slate-800 whitespace-pre-wrap break-words mb-3">
        {post.content}
      </div>

      {/* Image or Video */}
      {post.image && (
        (() => {
          const isVideoPost = /\.(mp4|webm|mov|avi)(\?|$)/i.test(post.image);
          if (isVideoPost) {
            return (
              <div className="mb-3 rounded-xl overflow-hidden border border-slate-100 bg-black">
                <video
                  src={post.image}
                  controls
                  className="w-full max-h-[420px] object-contain"
                  onError={(e) => {
                    (e.target as HTMLVideoElement).style.display = 'none';
                  }}
                />
              </div>
            );
          }
          return (
            <div 
              className="mb-3 rounded-xl overflow-hidden border border-slate-100 group relative cursor-pointer"
              onClick={() => openPhoto({ 
                src: post.image!, 
                alt: `Фото от ${post.user.display_name}`, 
                post: post,
                type: 'post'
              })}
            >
              <img
                src={post.image}
                alt="Post attachment"
                className="w-full max-h-[420px] object-cover transition-transform group-hover:scale-[1.015]"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <ZoomIn className="w-3 h-3" /> Открыть
              </div>
            </div>
          );
        })()
      )}

      {/* Actions */}
      <div className="flex items-center gap-6 pt-2 border-t border-slate-100">
        <button
          onClick={handleLike}
          disabled={isLiking}
          className={`like-button flex items-center gap-2 text-sm font-medium transition-colors ${
            isLiked ? 'liked text-red-500' : 'text-slate-500 hover:text-red-500'
          }`}
        >
          <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
          <span>{likeCount}</span>
        </button>

        <button
          onClick={toggleComments}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          <span>{localCommentCount}</span>
        </button>

        <button
          onClick={handleBookmark}
          disabled={isBookmarking}
          className={`flex items-center gap-1.5 text-sm font-medium transition-colors ml-auto ${
            isBookmarked ? 'text-amber-600' : 'text-slate-500 hover:text-amber-600'
          }`}
          title={isBookmarked ? 'Убрать из закладок' : 'Сохранить в закладки'}
        >
          {isBookmarked ? (
            <BookmarkCheck className="w-5 h-5 fill-current" />
          ) : (
            <Bookmark className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {user && token && (
            <form onSubmit={handleAddComment} className="flex gap-2 mb-3">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Написать комментарий..."
                className="input flex-1 text-sm py-1.5"
                disabled={commentActionLoading}
              />
              <button
                type="submit"
                disabled={!newComment.trim() || commentActionLoading}
                className="btn-primary px-3 py-1 text-sm rounded-xl disabled:opacity-50"
              >
                Отправить
              </button>
            </form>
          )}

          {loadingComments && (
            <div className="text-sm text-slate-500 py-2">Загрузка комментариев...</div>
          )}

          <div className="space-y-3 max-h-64 overflow-auto pr-1">
            {comments.length === 0 && !loadingComments && (
              <div className="text-sm text-slate-500 py-1">Пока нет комментариев. Будьте первым!</div>
            )}
            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-2 text-sm">
                <Link to={`/profile/${comment.user.username}`}>
                  <Avatar src={comment.user.avatar} alt={comment.user.username} size="sm" />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/profile/${comment.user.username}`} className="font-medium text-slate-900 hover:text-indigo-600">
                      {comment.user.display_name}
                    </Link>
                    <span className="text-xs text-slate-400">{timeAgo(comment.created_at)}</span>
                    {user?.id === comment.user.id && (
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        disabled={commentActionLoading}
                        className="ml-auto text-xs text-red-500 hover:text-red-600"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                  <p className="text-slate-700 whitespace-pre-wrap break-words">{comment.content}</p>
                  <button
                    onClick={() => handleLikeComment(comment)}
                    disabled={commentActionLoading}
                    className={`flex items-center gap-1 mt-0.5 text-xs ${comment.user_liked ? 'text-red-500' : 'text-slate-500 hover:text-red-500'}`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${comment.user_liked ? 'fill-current' : ''}`} />
                    <span>{comment.like_count}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
