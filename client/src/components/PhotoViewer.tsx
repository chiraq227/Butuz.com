import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { X, Heart, MessageCircle, Send, Trash2 } from 'lucide-react';
import Avatar from './Avatar';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

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
  comment_count?: number;
}

interface PhotoData {
  src: string;
  alt?: string;
  post?: Post;
  user?: {
    id: number;
    username: string;
    display_name: string;
    avatar: string;
  };
  type?: 'post' | 'message' | 'avatar';
}

interface PhotoViewerContextType {
  openPhoto: (data: PhotoData) => void;
  closePhoto: () => void;
}

const PhotoViewerContext = createContext<PhotoViewerContextType | null>(null);

export function PhotoViewerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [photoData, setPhotoData] = useState<PhotoData | null>(null);

  const openPhoto = (data: PhotoData) => {
    setPhotoData(data);
    setIsOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closePhoto = () => {
    setIsOpen(false);
    document.body.style.overflow = '';
    // Delay clearing data to allow exit animation if added later
    setTimeout(() => setPhotoData(null), 200);
  };

  return (
    <PhotoViewerContext.Provider value={{ openPhoto, closePhoto }}>
      {children}
      <PhotoModal 
        isOpen={isOpen} 
        onClose={closePhoto} 
        data={photoData} 
      />
    </PhotoViewerContext.Provider>
  );
}

export function usePhotoViewer() {
  const context = useContext(PhotoViewerContext);
  if (!context) {
    // Fallback for components outside provider (should not happen)
    return {
      openPhoto: (data: PhotoData) => {
        // Simple fallback: open in new tab
        window.open(data.src, '_blank');
      },
      closePhoto: () => {},
    };
  }
  return context;
}

// Internal modal component
function PhotoModal({ isOpen, onClose, data }: { 
  isOpen: boolean; 
  onClose: () => void; 
  data: PhotoData | null;
}) {
  const { user: currentUser, token } = useAuth();
  const [postState, setPostState] = useState<Post | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  const [currentPostId, setCurrentPostId] = useState<number | null>(null);

  // Sync post data
  useEffect(() => {
    if (data?.post?.id) {
      setPostState(data.post);
      setCurrentPostId(data.post.id);
      // Auto load comments for post photos
      loadComments(data.post.id);
    } else {
      setPostState(null);
      setCurrentPostId(null);
      setComments([]);
    }
  }, [data]);

  const loadComments = async (postId: number) => {
    if (!postId) return;
    setLoadingComments(true);
    try {
      const data = await api.getComments(postId, token || undefined);
      setComments(data || []);
    } catch (e) {
      console.error('Failed to load comments in viewer');
    } finally {
      setLoadingComments(false);
    }
  };

  const handleLike = async () => {
    if (!token || !postState || likeLoading) return;
    setLikeLoading(true);
    try {
      const res = await api.toggleLike(postState.id, token);
      setPostState(prev => prev ? {
        ...prev,
        user_liked: res.liked,
        like_count: res.like_count
      } : null);
    } catch (e) {
      console.error('Like failed in viewer');
    } finally {
      setLikeLoading(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !token || !currentPostId) return;
    setCommentLoading(true);
    try {
      const created = await api.createComment(currentPostId, newComment.trim(), token);
      setComments(prev => {
        const updated = [created, ...prev];
        return updated.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
      });
      setNewComment('');
      setPostState(prev => prev ? { ...prev, comment_count: (prev.comment_count || 0) + 1 } : null);
    } catch (e) {
      alert('Не удалось добавить комментарий');
    } finally {
      setCommentLoading(false);
      // Re-fetch to keep in sync with server sorting and data
      if (currentPostId) loadComments(currentPostId);
    }
  };

  const handleLikeComment = async (comment: any) => {
    if (!token || commentLoading) return;
    setCommentLoading(true);
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
      setCommentLoading(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!token || !confirm('Удалить комментарий?')) return;
    setCommentLoading(true);
    try {
      await api.deleteComment(commentId, token);
      setComments(prev => prev.filter(c => c.id !== commentId));
      setPostState(prev => prev ? { ...prev, comment_count: Math.max(0, (prev.comment_count || 0) - 1) } : null);
    } catch (e) {
      alert('Не удалось удалить комментарий');
    } finally {
      setCommentLoading(false);
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

  // Keyboard support
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !data) return null;

  const isPost = !!postState;
  const isProfilePhoto = data.type === 'avatar' || (!!data.user && !isPost);

  return (
    <div 
      className="fixed inset-0 z-[300] bg-black/95 flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-6xl max-h-[96vh] bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition min-w-[44px] min-h-[44px] flex items-center justify-center"
          style={{ top: 'max(1rem, env(safe-area-inset-top))', right: 'max(1rem, env(safe-area-inset-right))' }}
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Image area */}
        <div className="flex-1 bg-black flex items-center justify-center p-4 md:p-8 relative min-h-[300px] md:min-h-[500px]">
          <img
            src={data.src}
            alt={data.alt || 'Photo'}
            className="max-h-[70vh] md:max-h-[85vh] max-w-full object-contain rounded-lg"
            onError={(e) => {
              (e.target as HTMLImageElement).style.opacity = '0.3';
            }}
          />
        </div>

        {/* Info panel - for posts */}
        {currentPostId && postState && (
          <div className="w-full md:w-96 border-t md:border-t-0 md:border-l bg-white flex flex-col max-h-[50vh] md:max-h-[85vh]">
            {/* User header */}
            <div className="p-4 border-b flex items-center gap-3 flex-shrink-0">
              <Avatar src={postState.user.avatar} alt={postState.user.username} size="md" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900 truncate">{postState.user.display_name}</div>
                <div className="text-xs text-slate-500">@{postState.user.username} • {timeAgo(postState.created_at)}</div>
              </div>
            </div>

            {/* Post content */}
            {postState.content && (
              <div className="p-4 text-sm text-slate-700 whitespace-pre-wrap border-b flex-shrink-0">
                {postState.content}
              </div>
            )}

            {/* Likes */}
            <div className="px-4 py-3 border-b flex items-center gap-3 flex-shrink-0">
              <button
                onClick={handleLike}
                disabled={likeLoading}
                className={`flex items-center gap-2 text-sm font-medium transition ${
                  postState.user_liked ? 'text-red-500' : 'text-slate-600 hover:text-red-500'
                }`}
              >
                <Heart className={`w-5 h-5 ${postState.user_liked ? 'fill-current' : ''}`} />
                <span>{postState.like_count}</span>
              </button>
              <div className="text-sm text-slate-500">лайков</div>
            </div>

            {/* Comments */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
                <MessageCircle className="w-4 h-4" />
                КОММЕНТАРИИ ({postState.comment_count || comments.length})
              </div>

              {loadingComments && (
                <div className="text-center py-4 text-slate-400 text-xs">Загрузка комментариев...</div>
              )}

              {!loadingComments && comments.length === 0 && (
                <div className="text-center py-3 text-slate-400 text-xs">Нет комментариев</div>
              )}

              {comments.map((comment) => {
                const isOwnComment = currentUser?.id === comment.user?.id;
                return (
                  <div key={comment.id} className="flex gap-2 group">
                    <Avatar src={comment.user?.avatar} alt={comment.user?.username} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-slate-900 text-xs">{comment.user?.display_name}</span>
                        <span className="text-[10px] text-slate-400">{timeAgo(comment.created_at)}</span>
                      </div>
                      <div className="text-slate-700 text-xs leading-snug mt-0.5 break-words">{comment.content}</div>
                      
                      <div className="flex items-center gap-3 mt-1 text-[10px]">
                        <button
                          onClick={() => handleLikeComment(comment)}
                          disabled={commentLoading}
                          className={`flex items-center gap-1 ${comment.user_liked ? 'text-red-500' : 'text-slate-400 hover:text-red-500'} disabled:opacity-50`}
                        >
                          <Heart className={`w-3 h-3 ${comment.user_liked ? 'fill-current' : ''}`} />
                          {comment.like_count || 0}
                        </button>
                        {isOwnComment && (
                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            disabled={commentLoading}
                            className="text-red-400 hover:text-red-600 opacity-70 group-hover:opacity-100 disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add comment */}
            {currentUser && (
              <form onSubmit={handleAddComment} className="p-3 border-t flex gap-2 flex-shrink-0 bg-slate-50">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Написать комментарий..."
                  className="flex-1 text-sm bg-white border border-slate-200 rounded-full px-4 py-2 focus:outline-none focus:border-indigo-300"
                  disabled={commentLoading}
                />
                <button
                  type="submit"
                  disabled={!newComment.trim() || commentLoading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-full text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        )}

        {/* Simple viewer for messages / profile photos */}
        {!isPost && (
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l bg-white p-6 flex flex-col items-center justify-center text-center">
            {data.user && (
              <>
                <div className="mb-4">
                  <Avatar src={data.user.avatar} alt={data.user.username} size="lg" />
                </div>
                <div className="font-semibold text-lg">{data.user.display_name}</div>
                <div className="text-slate-500">@{data.user.username}</div>
                <div className="mt-6 text-xs text-slate-400">
                  {data.type === 'avatar' ? 'Фото профиля' : 'Вложение'}
                </div>
              </>
            )}
            {!data.user && (
              <div className="text-slate-500 text-sm">Фото</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
