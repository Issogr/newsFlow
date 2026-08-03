import GitHubIcon from './icons/GitHubIcon';

const ProjectGitHubLink = () => (
  <a
    href="https://github.com/Issogr/newsFlow"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="GitHub"
    className="inline-flex items-center justify-center rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
  >
    <GitHubIcon className="h-5 w-5" />
  </a>
);

export default ProjectGitHubLink;
