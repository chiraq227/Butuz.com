import { useState, useRef, useEffect } from 'react';
import { Image, X, Send, Film } from 'lucide-react';
import Avatar from './Avatar';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

interface CreatePostProps {
  onPostCreated: (post: any) => void;
}

export default function CreatePost({ onPostCreated }: CreatePostProps) {
  const { user, token } = useAuth();
  const [content, setContent] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const composerRef = useRef<HTMLDivElement>(null);

  const isVideo = (file: File) => file.type.startsWith('video/');

  const handleMediaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = isVideo(file) ? 25 * 1024 * 1024 : 8 * 1024 * 1024; // 25MB video, 8MB image
    if (file.size > maxSize) {
      alert(`Файл слишком большой. Максимум ${isVideo(file) ? '25' : '8'} МБ.`);
      e.target.value = '';
      return;
    }

    setMediaFile(file);
    setMediaType(isVideo(file) ? 'video' : 'image');

    // Use object URL for better video preview performance
    const url = URL.createObjectURL(file);
    setMediaPreview(url);
  };

  const removeMedia = () => {
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaFile(null);
    setMediaPreview(null);
    setMediaType(null);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();

          if (file.size > 8 * 1024 * 1024) {
            alert('Изображение из буфера слишком большое (макс 8 МБ).');
            return;
          }

          if (mediaPreview) URL.revokeObjectURL(mediaPreview);

          const url = URL.createObjectURL(file);
          setMediaFile(file);
          setMediaType('image');
          setMediaPreview(url);
          return;
        }
      }
    }
  };

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview);
      }
    };
  }, [mediaPreview]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasText = content.trim().length > 0;
    const hasMedia = !!mediaFile;
    if ((!hasText && !hasMedia) || !token) return;
    if (hasText && content.trim().length > 1250) {
      alert('Слишком длинный пост. Максимум 1250 символов.');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('content', content.trim());
      if (mediaFile) {
        // Backend still expects 'image' field name (reused for video too)
        formData.append('image', mediaFile);
      }

      const newPost = await api.createPost(formData, token);
      onPostCreated(newPost);
      setContent('');
      removeMedia();
    } catch (err: any) {
      alert(err.message || 'Не удалось опубликовать пост');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      ref={composerRef}
      className="bg-white border border-slate-200 rounded-2xl p-5 mb-6"
      onPaste={handlePaste}
    >
      <form onSubmit={handleSubmit}>
        <div className="flex gap-4">
          <Avatar src={user?.avatar} alt={user?.username} />

          <div className="flex-1">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Что происходит? (можно вставить фото из буфера)"
              className="input w-full resize-y min-h-[90px] text-lg placeholder:text-slate-400 border-0 focus:ring-0 px-2 py-1 rounded-2xl"
              maxLength={1250}
            />

            {/* Media preview (image or video) */}
            {mediaPreview && (
              <div className="relative mt-3 rounded-2xl overflow-hidden border max-w-sm">
                {mediaType === 'video' ? (
                  <video 
                    src={mediaPreview} 
                    controls 
                    className="w-full max-h-[280px] bg-black" 
                  />
                ) : (
                  <img src={mediaPreview} alt="Preview" className="w-full" />
                )}
                <button
                  type="button"
                  onClick={removeMedia}
                  className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1 rounded-full"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {mediaType === 'video' ? 'Видео' : 'Фото'}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
              <label className="cursor-pointer flex items-center gap-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                <div className="flex items-center gap-1">
                  <Image className="w-5 h-5" />
                  <Film className="w-5 h-5" />
                </div>
                <span>Фото / Видео</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleMediaChange}
                  className="hidden"
                />
              </label>

              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{content.length}/1250</span>
                <button
                  type="submit"
                  disabled={(!content.trim() && !mediaFile) || isSubmitting}
                  className="btn-primary flex items-center gap-2 px-5 py-2 text-white text-sm font-semibold rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {isSubmitting ? 'Публикуем...' : 'Опубликовать'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
