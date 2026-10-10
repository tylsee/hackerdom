import { useEffect } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
interface Props {
  html: string;
  label: string;
  onChange: (html: string) => void;
  onFocus: (editor: Editor) => void;
  onReady: (editor: Editor) => void;
  onBlur?: () => void;
}
export function RichSection({ html, label, onChange, onFocus, onReady, onBlur }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: html,
    parseOptions: { preserveWhitespace: 'full' },
    editorProps: {
      attributes: {
        class: 'section-content',
        role: 'textbox',
        'aria-label': `Edit ${label}`,
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onFocus: ({ editor }) => onFocus(editor),
    onBlur: () => onBlur?.(),
  });
  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor]);
  useEffect(() => {
    if (editor && editor.getHTML() !== html)
      editor.commands.setContent(html, {
        emitUpdate: false,
        parseOptions: { preserveWhitespace: 'full' },
      });
  }, [html, editor]);
  return <EditorContent editor={editor} />;
}
