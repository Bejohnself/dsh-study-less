/**
 * Browser entry of the standalone build.
 *
 * The plugin half registers this app into the DSH shell's slots; here it owns
 * the page instead. Styles and theme are the same modules the plugin installs.
 */
import { createRoot } from 'react-dom/client'
import { StudyApp } from '../src/client/app.tsx'
import { ensureStudyStyles } from '../src/client/styles.ts'
import { installTheme } from '../src/client/theme.ts'

ensureStudyStyles()
installTheme()

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root 节点')
createRoot(container).render(<StudyApp />)