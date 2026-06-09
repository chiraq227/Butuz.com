import { useEffect, useState } from 'react';
import PostCard from '../components/PostCard';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Bookmark } from 'lucide-react';

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
  is_pinned?: boolean;
  comment_count?: number;
}

export default function Bookmarks() {
  const { token } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBookmarks = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.getBookmarks(token);
      setPosts(data);
    } catch (e: any) {
      setError(e.message || 'Не удалось загрузить закладки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBookmarks();
  }, [token]);

  const handleLikeChange = (postId: number, liked: boolean, count: number) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, user_liked: liked, like_count: count } : p
      )
    );
  };

  const handlePostDeleted = (postId: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  // When unbookmarking from this page, remove it from list
  const handleBookmarkChange = (postId: number, bookmarked: boolean) => {
    if (!bookmarked) {
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Bookmark className="w-8 h-8 text-slate-700" />
        <div>
          <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Закладки</h1>
          <p className="text-slate-500 mt-1">Сохранённые посты</p>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}

      {error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl mb-4">{error}</div>}

      {!loading && posts.length === 0 && (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-3xl">
          <Bookmark className="w-12 h-12 mx-auto text-slate-300 mb-4" />
          <p className="text-slate-600">У вас пока нет сохранённых постов.</p>
          <p className="text-sm text-slate-500 mt-1">Нажимайте на значок закладки в ленте, чтобы сохранить интересные записи.</p>
        </div>
      )}

      <div className="space-y-5 pb-12">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onDelete={handlePostDeleted}
            onLikeChange={handleLikeChange}
            onBookmarkChange={handleBookmarkChange}
          />
        ))}
      </div>
    </div>
  );
}
