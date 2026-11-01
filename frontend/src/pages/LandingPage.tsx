import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Avatar, Wordmark } from "../ui";

export function LandingPage() {
  const { user } = useAuth();
  const enter = user ? "/app" : "/login";
  const enterLabel = user ? "Открыть доску" : "Войти";

  return (
    <main className="landing">
      <header className="land-bar">
        <Wordmark />
        <Link className="btn primary" to={enter}>
          {enterLabel}
        </Link>
      </header>

      <section className="land-hero">
        <div className="land-copy">
          <p className="kicker">Доска Романа</p>
          <h1>Английский на одной доске</h1>
          <p className="lede">
            Mira — общая доска для занятия. Роман пишет, рисует и выделяет слова, а ученик видит это сразу, в своей комнате.
          </p>
          <div className="land-actions">
            <Link className="btn primary land-cta" to={enter}>
              {enterLabel}
            </Link>
            <a className="btn ghost" href="#how">
              Как проходит урок
            </a>
          </div>
          <span className="tutor-plate">
            <Avatar />
            <span>
              <strong>Роман</strong>
              <em>ведёт английский здесь</em>
            </span>
          </span>
        </div>

        <div className="board-mock" aria-hidden="true">
          <article className="mock-sticky">
            <span className="mock-name">Роман</span>
            <p>
              <mark>friendly</mark>
            </p>
            <p>дружелюбный</p>
          </article>
          <article className="mock-card">
            <span>present simple</span>
            <strong>I work every day</strong>
            <em>я работаю каждый день</em>
          </article>
          <span className="mock-shape" />
          <span className="mock-cursor">
            <Avatar className="tiny" />
            Роман
          </span>
        </div>
      </section>

      <section className="land-points">
        <article>
          <h2>Своя комната</h2>
          <p>У каждого ученика свой пароль. Он открывает только свою доску и не видит чужие занятия.</p>
        </article>
        <article>
          <h2>Всё сразу</h2>
          <p>Курсоры, заметки и выделенные слова появляются у всех, кто сейчас в комнате.</p>
        </article>
        <article>
          <h2>Для живого урока</h2>
          <p>Стикеры, текст, фигуры, стрелки, маркер, картинки и PDF — прямо во время разговора.</p>
        </article>
      </section>

      <section className="land-how" id="how">
        <p className="kicker">Три шага</p>
        <h2>Как проходит урок</h2>
        <ol>
          <li>
            <strong>Роман открывает комнату</strong>
            <span>Называет её и задаёт пароль, который скажет ученику.</span>
          </li>
          <li>
            <strong>Ученик входит</strong>
            <span>Нажимает «Войти», затем открывает комнату по этому паролю.</span>
          </li>
          <li>
            <strong>Доска одна на двоих</strong>
            <span>Что написали, сдвинули или выделили — видно обоим.</span>
          </li>
        </ol>
      </section>

      <section className="land-close">
        <h2>Занятие начинается на доске</h2>
        <Link className="btn primary land-cta" to={enter}>
          {enterLabel}
        </Link>
      </section>
    </main>
  );
}
