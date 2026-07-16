// FAROL - render rico do espelho do terminal: markdown REAL (tabelas,
// negrito, headers, listas, links clicaveis, codigo) no lugar do texto cru
// com **marcadores** visiveis. Memo por texto: linha antiga do espelho nao
// re-parseia a cada poll (o pai so troca a REFERENCIA quando o texto muda).
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import './prose-md.css';

const components = {
  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
  // tabela com wrapper de scroll horizontal (nunca estoura a largura do pane).
  table: (props) => <div className="pmd-tablewrap"><table {...props} /></div>,
};

export default memo(function ProseMd({ text }) {
  return (
    <div className="pmd">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {text || ''}
      </ReactMarkdown>
    </div>
  );
}, (a, b) => a.text === b.text);
