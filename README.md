# ExamFlow

A modern, elegant exam and practice testing platform designed for seamless test-taking and performance tracking.

**Live Demo:** [exam-flow-rho.vercel.app](https://exam-flow-rho.vercel.app)

---

## Overview

ExamFlow is a full-featured testing application that combines a beautiful, responsive UI with powerful exam mechanics. Whether you're preparing for exams or administering tests, ExamFlow provides an intuitive interface with real-time tracking, detailed result analysis, and flexible question types.

### Key Features

✨ **Modern Interface**
- Clean, accessible design with light and dark mode support
- Responsive layout for desktop and mobile devices
- Smooth animations and intuitive navigation

📝 **Flexible Question Types**
- Multiple choice questions with instant feedback
- Fill-in-the-blank / short answer responses
- Matching questions with dropdown selection
- Ordering/ranking questions
- Support for mathematical expressions via KaTeX

⏱️ **Exam Management**
- Real-time countdown timer with visual indicators
- Question progress tracking with persistent navigator
- Bookmark/flag important questions for review
- Practice mode vs. exam mode with different UX flows

📊 **Detailed Analytics**
- Comprehensive test result summaries
- Per-question performance breakdown
- Time spent analytics
- Success/failure patterns and insights
- Visual progress indicators

💾 **Data Persistence**
- Load and save exam sessions
- JSON-based data import/export
- Session history for review

🎨 **Enhanced Readability**
- Academic typography with serif fonts for questions
- Optimized line-height and letter-spacing
- Mathematical formula rendering with KaTeX
- Responsive text sizing across all devices

---

## Getting Started

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, Edge)
- No backend server required – fully client-side application

### Running Locally

1. Clone the repository:
```bash
git clone https://github.com/field-access/ExamFlow.git
cd ExamFlow
```

2. Open `index.html` in your browser or serve with a local web server:
```bash
# Using Python 3
python -m http.server 8000

# Using Node.js
npx http-server
```

3. Navigate to `http://localhost:8000` (or the port shown)

---

## Project Structure

```
ExamFlow/
├── index.html           # Main application (latest version)
├── index_prev4.html     # Previous version 4 backup
├── index_prev5.html     # Previous version 5 backup
├── version3.html        # Legacy version 3
├── version4.html        # Legacy version 4
└── README.md
```

The application is built as a single-file HTML application with embedded CSS and JavaScript for easy deployment.

---

## Usage Guide

### Home View
- Start a new exam or practice session
- Import exam data via JSON
- View previous session history
- Set personal goals and milestones

### Practice/Exam Mode
- Review questions one at a time
- Select answers from multiple choice options
- See instant feedback in practice mode
- Use the question navigator to jump between questions
- Monitor remaining time with the countdown timer

### Results View
- View overall score and performance metrics
- Review each question with your answer and explanation
- Analyze time spent per question
- Identify areas for improvement

### Settings
- Toggle dark/light mode
- Adjust font size and spacing preferences
- Manage saved sessions

---

## Features in Detail

### Dark Mode
The application includes a sophisticated dark theme that:
- Automatically adjusts all UI elements for reduced eye strain
- Maintains readability with carefully chosen contrast ratios
- Preserves color-coding (green for correct, red for incorrect)

### Question Navigator
- Visual grid showing question status:
  - **Blue**: Current question
  - **Green**: Answered correctly
  - **Gold**: Flagged for review
  - **Gray**: Not yet attempted
- Click any question to jump directly to it
- Draggable on larger screens for persistent access

### Mathematics Support
Questions can include LaTeX/KaTeX expressions:
- Inline math: `\(x^2 + y^2 = z^2\)`
- Display math: `\[\frac{\partial}{\partial t}\]`
- Auto-renders when questions load

### Responsive Design
- **Desktop**: Full layout with sidebar question navigator
- **Tablet**: Condensed layout with drawer navigator
- **Mobile**: Single-column layout, optimized touch targets

---

## Data Format

### Importing Exam Data

Format your exam data as JSON:

```json
{
  "title": "Chemistry Midterm",
  "instructions": "Answer all questions to the best of your ability.",
  "time_limit_minutes": 60,
  "questions": [
    {
      "id": 1,
      "text": "What is the atomic number of Carbon?",
      "type": "multiple_choice",
      "options": [
        { "id": "A", "text": "4" },
        { "id": "B", "text": "6" },
        { "id": "C", "text": "8" }
      ],
      "correct_answer": "B",
      "explanation": "Carbon has 6 protons and an atomic number of 6."
    }
  ]
}
```

### Supported Question Types

1. **multiple_choice** - Single correct answer from options
2. **fill_in_blank** - Text input answer
3. **matching** - Match items to categories
4. **ordering** - Arrange items in correct sequence

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome  | ✅ Full |
| Firefox | ✅ Full |
| Safari  | ✅ Full |
| Edge    | ✅ Full |
| IE 11   | ❌ Not supported |

---

## Recent Updates

### Current Branch: `jules-fix-dark-mode-and-ui-bugs`
- Dark mode improvements and refinements
- UI bug fixes for better user experience
- Enhanced readability across all views

See [releases](https://github.com/field-access/ExamFlow/releases) for version history.

---

## Contributing

We welcome contributions! Please feel free to:
- Report bugs via [Issues](https://github.com/field-access/ExamFlow/issues)
- Suggest features or improvements
- Submit pull requests with enhancements

---

## License

This project is provided as-is for educational and testing purposes.

---

## Support

For issues, questions, or feature requests, please open an issue on [GitHub Issues](https://github.com/field-access/ExamFlow/issues).

---

**Built with ❤️ for better exam preparation**
