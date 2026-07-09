import React, { useState, useEffect } from 'react';
import { X, Plus, CheckSquare, Square, Trash2, ChevronUp, ChevronDown, ListTodo } from 'lucide-react';

// Todos are now stored as: todos[date][section][subject] = [ {id, text, isCompleted}, ... ]
// The extra `section` level means Section A's notes for "OB" on a given date never mix
// with Section B's notes for the same subject/date.

export function TodoModal({ isOpen, onClose, activeClass, todos, onUpdate }) {
  const [newTask, setNewTask] = useState('');

  // Lock body scroll when modal is open on mobile
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen || !activeClass) return null;

  const { date, section, subject } = activeClass;
  const currentTodos = todos[date]?.[section]?.[subject] || [];

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    const newTaskObj = { id: Date.now().toString(), text: newTask.trim(), isCompleted: false };
    onUpdate(date, section, subject, [...currentTodos, newTaskObj]);
    setNewTask('');
  };

  const toggleTask = (taskId) => {
    const updated = currentTodos.map(t => t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t);
    onUpdate(date, section, subject, updated);
  };

  const deleteTask = (taskId) => {
    const updated = currentTodos.filter(t => t.id !== taskId);
    onUpdate(date, section, subject, updated);
  };

  return (
    <div className="todo-overlay" onClick={onClose}>
      <div className="todo-bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="todo-sheet-header">
          <div>
            <h3 className="todo-subject">{subject}</h3>
            <p className="todo-date">
              Section {section} &middot; {new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </p>
          </div>
          <button className="todo-close-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="todo-list-container">
          {currentTodos.length === 0 ? (
            <div className="todo-empty">No tasks added yet.</div>
          ) : (
            currentTodos.map(task => (
              <div key={task.id} className={`todo-item ${task.isCompleted ? 'completed' : ''}`}>
                <button className="todo-check-btn" onClick={() => toggleTask(task.id)}>
                  {task.isCompleted ? <CheckSquare size={20} color="var(--accent-gold)" /> : <Square size={20} color="#888" />}
                </button>
                <span className="todo-text">{task.text}</span>
                <button className="todo-delete-btn" onClick={() => deleteTask(task.id)}>
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
        </div>

        <form className="todo-input-form" onSubmit={handleAddTask}>
          <input
            type="text"
            placeholder="Add a new task or note..."
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
          />
          <button type="submit" disabled={!newTask.trim()}><Plus size={20} /></button>
        </form>
      </div>
    </div>
  );
}

export function TodoSummaryBar({ date, section, todos, onOpenClass }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const dayData = todos[date]?.[section] || {};
  const subjectsWithTasks = Object.keys(dayData);

  let totalTasks = 0;
  let completedTasks = 0;

  subjectsWithTasks.forEach(subject => {
    dayData[subject].forEach(task => {
      totalTasks++;
      if (task.isCompleted) completedTasks++;
    });
  });

  if (totalTasks === 0) return null;

  return (
    <div className={`todo-summary-bar ${isExpanded ? 'expanded' : ''}`}>
      <div className="todo-summary-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="todo-summary-info">
          <ListTodo size={18} color="var(--accent-gold)" />
          <span><strong>{completedTasks}/{totalTasks}</strong> Tasks for Today &middot; Sec {section}</span>
        </div>
        {isExpanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
      </div>

      {isExpanded && (
        <div className="todo-summary-list">
          {subjectsWithTasks.map(subj => (
            <div key={subj} className="todo-summary-subject-group" onClick={() => onOpenClass(subj)}>
              <div className="todo-summary-subject-title">{subj}</div>
              {dayData[subj].map(task => (
                <div key={task.id} className={`todo-summary-item ${task.isCompleted ? 'completed' : ''}`}>
                  {task.isCompleted ? <CheckSquare size={14} color="var(--accent-gold)" /> : <Square size={14} color="#888" />}
                  <span className="todo-summary-text">{task.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}