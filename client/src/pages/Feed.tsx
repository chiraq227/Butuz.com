import { useEffect, useState } from 'react';
import CreatePost from '../components/CreatePost';
import PostCard from '../components/PostCard';
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
  is_bookmarked?: boolean;
  is_pinned?: boolean;
  comment_count?: number;
}

export default function Feed() {
  const { token } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPosts = async () => {
    try {
      const data = await api.getPosts(token || undefined);
      setPosts(data);
    } catch (e: any) {
      setError(e.message || 'Не удалось загрузить ленту');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  const handlePostCreated = (newPost: Post) => {
    setPosts((prev) => [newPost, ...prev]);
  };

  const handlePostDeleted = (postId: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  const handleLikeChange = (postId: number, liked: boolean, count: number) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, user_liked: liked, like_count: count } : p
      )
    );
  };

  const handleBookmarkChange = (postId: number, bookmarked: boolean) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, is_bookmarked: bookmarked } : p))
    );
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Главная лента</h1>
        <p className="text-slate-500 mt-1">Последние публикации от друзей и сообщества</p>
      </div>

      <CreatePost onPostCreated={handlePostCreated} />

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}

      {error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl mb-4">{error}</div>}

      {!loading && posts.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          Пока нет постов. Будьте первым!
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
            allowPinning={false}
          />
        ))}
      </div>
    </div>
  );
}
