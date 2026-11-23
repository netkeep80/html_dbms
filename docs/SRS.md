# HTML DBMS — спецификация требований, экспериментальный протокол 2.2

**Состояние:** рабочая спецификация до первого стабильного релиза. Версия 2.2 полностью заменяет 2.1; обратная совместимость намеренно отсутствует.

## 1. Назначение и границы

**BG-01.** Пользователь должен иметь возможность вести переносимую структурированную БД в одном автономном HTML-файле без отдельного сервера и установки СУБД.

В границах 2.2: автономный HTML, несколько логических криптоцепочек в одном JSON Object, deterministic genesis и successor addresses, AES-256-GCM, optional operational head, JSON Patch RFC 6902, JSON Pointer RFC 6901, immutable transaction schema, structured diagnostics и явное восстановление хвоста.

Вне границ: гарантированная конфиденциальность предсказуемого plaintext, authenticated authorship, распределённый консенсус, автоматическое разрешение offline forks и миграция старых экспериментальных форматов.

## 2. Основные инварианты

- **BR-01.** Genesis определяет семантическую идентичность логической цепочки.
- **BR-02.** Один predecessor `(ID,H)` определяет ровно один canonical successor address.
- **BR-03.** Занятый successor slot не перезаписывается неявно. Явная перезапись допустима после отдельного подтверждения пользователя.
- **BR-04.** Explicit overwrite меняет только один canonical slot и не удаляет старых потомков автоматически.
- **BR-05.** Старый поздний head после замены промежуточного slot должен обнаруживать разрыв ancestry, а не молча принимать новую ветвь.
- **BR-06.** Transaction schema и смысл полей принадлежат transaction genesis и неизменяемы последующими main events.
- **BR-07.** Чтение является read-only; любое физическое удаление выполняется отдельной явной операцией.
- **BR-08.** Все хэшируемые значения принадлежат строгому JSON-domain.
- **BR-09.** До первого стабильного релиза поддерживается только текущий экспериментальный формат.
- **BR-10.** Независимый доверенный H необходим для утверждений о provenance; встроенный self-verifier не доказывает авторство.

## 3. Контейнер и operational head

Контейнер:

```json
{
  "format": "HTML_DBMS/2.2",
  "publicHead": null,
  "records": {}
}
```

`publicHead` имеет ровно одну из форм:

```text
null
[null, H]
[ID, H]
```

Семантика:

| Форма | Поведение |
|---|---|
| `null` | точка входа не опубликована; UI запрашивает H либо ID+H |
| `[null,H]` | поиск physical ID по H, стоимость зависит от числа physical records |
| `[ID,H]` | прямое чтение head по известному physical ID |

При ручном открытии скрытой БД сохранение не должно автоматически публиковать head. Пользователь явно выбирает режим публикации следующей HTML-копии.

## 4. Сериализованная запись

Запись:

```text
[seq, kind, time, prev_key, prev_hash, payload]
```

Genesis:

```text
[1, "genesis", null, null, null, {policy,state}]
```

Patch event:

```text
[n, "patch", ISO-UTC-time, IDprev, Hprev, {patch:[...]}]
```

Patch timestamp обязан быть строкой формата, эквивалентного `Date.toISOString()`.

## 5. Криптографическое преобразование

Для точных байтов сериализованной записи:

```text
P = UTF8(JSON.stringify(record))
H = SHA256(P)
K = H
```

Genesis address:

```text
ID0 = B64URL(first16(SHA256(raw(H0))))
```

Successor address:

```text
IDi = B64URL(first16(SHA256(raw(IDprev) || raw(Hprev))))
```

`raw(IDprev)` имеет 16 байт, `raw(Hprev)` — 32 байта. Конкатенация поэтому однозначна.

AES-GCM:

```text
key = H
IV = first12(raw(ID))
tagLength = 128
```

Ciphertext хранится непосредственно как `records[ID]` в каноническом Base64url.

## 6. Genesis

Genesis не получает автоматически timestamp, random physical ID или скрытый nonce. Одинаковый genesis должен давать одинаковые `H0`, `ID0` и ciphertext.

Если создателю нужны независимые экземпляры либо непредсказуемый root, он включает различающие данные, например случайный nonce, в сам genesis. Такой nonce является частью содержимого и идентичности цепочки.

## 7. JSON-only domain

До hash/ID/commit должны быть отвергнуты значения, которые JSON сериализует неоднозначно относительно JavaScript состояния:

- `undefined`;
- NaN и ±Infinity;
- BigInt;
- Function и Symbol;
- циклические объекты;
- sparse arrays и массивы с дополнительными свойствами;
- Date, Map, Set и другие неплоские экземпляры классов;
- accessor/non-enumerable/symbol properties в protocol objects.

Разрешены `null`, boolean, конечные числа, строки, плотные массивы и plain objects, рекурсивно состоящие из разрешённых значений.

## 8. Transaction genesis и schema

Transaction genesis state имеет минимальную форму:

```json
{
  "title": "...",
  "columns": {
    "field": {"title":"...","type":"text|number|date"}
  },
  "rows": {}
}
```

`columns` является immutable schema и одновременно описанием отображения. После genesis transaction policy допускает только одну операцию `add /rows/<new-id>` на событие.

Каждая строка обязана иметь набор полей schema и корректные типы. Проверка выполняется одной логикой:

1. до записи в `append`;
2. повторно при `load/replay` каждой исторической записи.

Main-цепочка не хранит transaction columns и не может изменить смысл исторических строк.

## 9. Main state и вложенные цепочки

Chain table в main содержит:

```json
{
  "title": "...",
  "type": "chain",
  "head": ["ID", "H"]
}
```

При replay основной цепочки система должна анализировать **effective state после каждого event**, а не только синтаксис Patch. Каждый очередной nested head должен находиться в ancestry финальной вложенной transaction chain и не может откатываться к более раннему индексу.

Замена parent subtree, root, `move`, `copy` или иной JSON Patch не должна обходить этот инвариант.

## 10. Append и занятый successor

Перед append вычисляется canonical `IDnext=f(ID,H)`.

Если slot отсутствует, запись выполняется обычным образом.

Если slot занят:

1. обычный append не меняет `records`;
2. возвращается `SUCCESSOR_OCCUPIED` с physical ID;
3. UI объясняет, что это может быть более свежая скрытая версия, offline fork, squatting или повреждение;
4. система не обязана уметь прочитать occupant без его H;
5. пользователь может отдельно подтвердить overwrite;
6. overwrite меняет только `records[IDnext]`;
7. никакие старые descendants автоматически не удаляются.

Таким образом `(ID,H)` может использоваться как capability на конкретную версию истории. Пользователь с устаревшим head может определить лишь факт занятости непосредственного successor slot, но без `Hnext` не получает plaintext скрытого продолжения и не может вычислить следующие physical IDs.

## 11. Обнаружение перезаписи и разрыва

Пусть поздний event хранит `prev_key=IDx` и `prev_hash=Hx`. Если physical slot `records[IDx]` был заменён другой записью, decrypt под `Hx` и IV от `IDx` не проходит либо дальнейшая проверка hash/address завершается отказом.

Система должна вернуть структурированную диагностику `REPLACED_OR_CORRUPTED_PREDECESSOR`. Это доказывает, что текущее содержимое slot больше не соответствует ancestry, на которую ссылается потомок. Причина изменения — overwrite, порча или вмешательство — криптографически не различается автоматически.

После непрозрачного разрыва поздний suffix может быть внутренне читаем, но полная связь с genesis не считается доказанной, поскольку ссылка на более ранний predecessor была внутри утраченной записи.

## 12. inspect/load и диагностика

`inspect` является read-only и возвращает либо `status="complete"`, либо структурированную проблему. `load` возвращает полную chain только при `complete` и иначе завершает операцию ошибкой с той же диагностикой.

Минимальные коды:

- `HEAD_REQUIRED`;
- `HEAD_NOT_FOUND`;
- `HEAD_RECORD_MISSING`;
- `HEAD_RECORD_INVALID`;
- `MISSING_PREDECESSOR`;
- `REPLACED_OR_CORRUPTED_PREDECESSOR`;
- `SEQUENCE_MISMATCH`;
- `SCHEMA_VIOLATION`;
- `INVALID_PATCH` / `INVALID_STATE`;
- `RESOURCE_LIMIT`.

Диагностика должна содержать source head, известную некорректную запись и список известного хвоста, когда он однозначно определяется.

## 13. truncateInvalidTail

`truncateInvalidTail(...)` является отдельной destructive operation и никогда не вызывается автоматически из `load/inspect`.

Для replay/schema ошибки, где predecessor некорректного event известен, recovery head может быть получен из события. Для непрозрачной cryptographic break predecessor утраченной записи неизвестен; тогда пользователь обязан предоставить отдельно известный recovery `(ID,H)`.

Операция удаляет только диагностированный хвост и переводит опубликованный head на recovery pointer только если именно диагностированный source head был опубликован. Скрытый режим `publicHead=null` остаётся скрытым.

## 14. Внешний verifier

Внешний HTML читается как текст и разбирается инертным HTML parser. Допустим ровно один фактический DOM-узел:

```text
script#db-store[type="application/json"]
```

`db-store` внутри комментария, шаблона или другого неактивного текста не считается физическим хранилищем. Иностранный JavaScript не исполняется.

Verifier подтверждает, что извлечённое хранилище содержит криптографически корректную ancestry с доверенным H. Он не аттестует исполняемый код внешнего HTML и не доказывает авторство descendants.

## 15. Однозначность и ограничения ресурсов

Base64url для ID, H и ciphertext должен быть каноническим: повторное кодирование декодированных байтов обязано вернуть исходную строку.

Hash-only scan имеет лимиты количества physical records, размера одного ciphertext и суммарного ciphertext. Ограничения проверяются до дорогостоящей криптографии, насколько это возможно.

Direct `[ID,H]` load не должен предварительно сканировать весь `records`; он валидирует только посещаемую ancestry. Это обеспечивает стоимость порядка длины конкретной цепочки вместо полного physical map scan.

## 16. Функциональные требования

| ID | Требование |
|---|---|
| FR-01 | Автономный HTML открывается и сохраняется без обязательной сети. |
| FR-02 | Поддерживаются три формы operational head: null, H-only, ID+H. |
| FR-03 | Direct ID+H открывает head без полного scan. |
| FR-04 | H-only выполняет ограниченный поиск ID. |
| FR-05 | Hidden head не перечисляет скрытые цепочки автоматически. |
| FR-06 | Genesis и successor address вычисляются детерминированно по формулам раздела 5. |
| FR-07 | IV выводится из physical ID и отдельно не хранится. |
| FR-08 | Occupied successor вызывает `SUCCESSOR_OCCUPIED` без изменения store. |
| FR-09 | Explicit overwrite разрешён только после отдельного пользовательского подтверждения в UI. |
| FR-10 | Старые descendants после overwrite автоматически не удаляются. |
| FR-11 | Cryptographic break старой ancestry диагностируется явно. |
| FR-12 | Transaction schema хранится в transaction genesis и проверяется при append и replay. |
| FR-13 | Main nested continuity проверяется по effective states. |
| FR-14 | Все protocol values валидируются как JSON-domain до commit. |
| FR-15 | `truncateInvalidTail` является отдельной явной операцией. |
| FR-16 | Внешний verifier использует инертный HTML parser. |
| FR-17 | 2.1/2.0 и любые иные экспериментальные форматы отвергаются без миграции. |

## 17. Приёмочные сценарии

**UC-01 — direct head.** `[ID,H]` открывает chain, не выполняя полный поиск `records`.

**UC-02 — H-only.** `[null,H]` находит ID по physical map и восстанавливает ту же chain.

**UC-03 — hidden head.** `publicHead=null` при непустом `records` не открывает БД автоматически и предлагает ввод H либо ID+H.

**UC-04 — более свежая скрытая версия.** Пользователь с устаревшим `(ID,H)` вычисляет занятый `IDnext`; append не изменяет occupant до явного подтверждения.

**UC-05 — explicit overwrite.** После подтверждения canonical successor slot заменяется, но старый поздний descendant остаётся физически в map.

**UC-06 — свидетель старой истории.** Открытие по старому позднему head после UC-05 останавливается на заменённом predecessor и возвращает `REPLACED_OR_CORRUPTED_PREDECESSOR`.

**UC-07 — truncate.** Простое чтение UC-06 ничего не удаляет. Отдельный `truncateInvalidTail` с независимо известным recovery head удаляет только диагностированный хвост.

**UC-08 — schema replay.** Вручную сформированный cryptographically self-consistent transaction event с неправильным типом поля отвергается при replay как `SCHEMA_VIOLATION`.

**UC-09 — nested rollback.** Замена всего `/tables/transactions` на старый nested head обнаруживается как нарушение монотонности, даже если прямой path `/head` не использовался.

**UC-10 — HTML comment spoof.** `db-store` внутри HTML-комментария не принимается verifier как фактическое хранилище.

## 18. Безопасность и ограничения

`K=SHA256(P)` остаётся экспериментальной message-derived key конструкцией. Она не защищает low-entropy plaintext от offline guessing. Нестандартная общая AEAD-модель формально не доказана.

Дополнительная post-decrypt проверка SHA-256 обязательна, поскольку известный H одновременно является известным AES-ключом. Address check также обязателен: IV использует только первые 96 бит 128-битного physical ID.

Абсолютная availability невозможна при противнике, способном произвольно добавлять, удалять или заменять physical records. Занятый slot является наблюдаемым фактом, а не автоматическим доказательством легитимной более новой версии.

## 19. Прослеживаемость

- HDBMS-01 → криптоцепочка, разрыв ancestry, `src/core.js`, `tests/core.test.cjs`.
- HDBMS-02 → immutable transaction schema и nested continuity, `src/core.js`, `src/app.js`.
- HDBMS-06 → deterministic genesis и отсутствие легаси.
- HDBMS-07 → operational head и explicit overwrite; задачи #11/#14.
- HDBMS-08 → JSON-domain, schema replay, diagnostics/truncate; задача #12.
- HDBMS-09 → verifier, canonical Base64url, timestamp и limits; задача #13.

## 20. Управление изменениями

До первого стабильного релиза экспериментальные форматы могут заменяться несовместимо. После стабильного релиза политика совместимости должна быть утверждена отдельным нормативным требованием. До этого момента отсутствие legacy-кода является сознательным свойством проекта.
