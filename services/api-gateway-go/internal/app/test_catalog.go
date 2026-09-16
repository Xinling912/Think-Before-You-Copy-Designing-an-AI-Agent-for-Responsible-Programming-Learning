package app

type TestTopic struct {
	ID      string
	Label   string
	Summary string
	Icon    string
}

var testTopics = []TestTopic{
	{"python_syntax_program_structure", "Python Syntax and Program Structure", "Basic Python program structure, indentation, statements, expressions, comments, input, output, and the rules that make Python code syntactically valid.", "CodeOutlined"},
	{"variables_names_assignment", "Variables, Names, and Assignment", "Creating valid names, binding values to variables, assignment behavior, reassignment, naming rules, and tracing how variable values change.", "EditOutlined"},
	{"data_types_type_conversion", "Data Types and Type Conversion", "Core Python values and types, including integers, floating-point numbers, booleans, None, type inspection, and safe conversion between compatible types.", "DatabaseOutlined"},
	{"operators_expressions", "Operators and Expressions", "Arithmetic, comparison, logical, identity, and assignment operators; precedence; expression evaluation; and selecting an appropriate operator.", "CalculatorOutlined"},
	{"strings_text_processing", "Strings and Text Processing", "Creating strings, indexing text, slicing, formatting, common string methods, escaping characters, and performing beginner text-processing operations.", "FontSizeOutlined"},
	{"lists_tuples", "Lists and Tuples", "Creating ordered collections, reading and updating elements, list methods, tuple behavior, mutability, unpacking, and choosing between lists and tuples.", "UnorderedListOutlined"},
	{"dictionaries_sets", "Dictionaries and Sets", "Key-value storage, dictionary access and updates, dictionary methods, unique-value sets, membership, and common beginner collection operations.", "KeyOutlined"},
	{"indexing_slicing_membership", "Indexing, Slicing, and Membership", "Zero-based indexing, negative indexes, valid index ranges, slices, membership tests, sequence length, and avoiding off-by-one access errors.", "NumberOutlined"},
	{"conditionals_pattern_matching", "Conditional Statements and Pattern Matching", "Boolean conditions, if/elif/else control flow, nested decisions at beginner depth, and introductory match/case selection.", "BranchesOutlined"},
	{"loops_iteration", "Loops and Iteration", "for and while loops, range, enumerate, loop variables, break, continue, termination conditions, and tracing repeated execution.", "ReloadOutlined"},
	{"comprehensions", "Comprehensions", "Beginner list, set, and dictionary comprehensions; mapping and filtering values; and deciding when a normal loop is clearer.", "FilterOutlined"},
	{"functions_recursion", "Functions and Recursion", "Defining and calling functions, decomposing tasks, understanding function execution, and introductory recursion with clear base cases.", "FunctionOutlined"},
	{"parameters_returns_scope", "Parameters, Return Values, and Scope", "Parameters, arguments, defaults, return values, local and global names, scope rules, and following data into and out of functions.", "SwapOutlined"},
	{"modules_packages_imports_stdlib", "Modules, Packages, Imports, and Standard Library", "Importing modules, using standard-library functions, understanding module namespaces, organizing reusable code, and basic package use.", "AppstoreOutlined"},
	{"errors_exceptions_debugging", "Errors, Exceptions, and Debugging", "Reading tracebacks, distinguishing syntax and runtime errors, handling common exceptions, diagnosing causes, and applying a repeatable debugging process.", "BugOutlined"},
	{"files_io_serialization", "Files, Input/Output, and Serialization", "Opening and closing files safely, reading and writing text, paths, context managers, and beginner JSON or CSV serialization.", "FileTextOutlined"},
	{"classes_oop", "Classes and Object-Oriented Programming", "Defining classes, creating instances, attributes, methods, constructors, object state, and introductory inheritance without advanced metaprogramming.", "ApartmentOutlined"},
	{"iterators_generators_decorators_context", "Iterators, Generators, Decorators, and Context Managers", "Iteration protocols, yield-based generators, simple function decorators, with-statements, and the purpose of context management.", "DeploymentUnitOutlined"},
	{"testing_typing_tooling_environments", "Testing, Typing, Tooling, and Environments", "Writing basic tests, using assertions, introductory type hints, formatting and linting, virtual environments, package installation, and reproducible tooling.", "SafetyCertificateOutlined"},
	{"concurrency_libraries_frameworks", "Concurrency, External Libraries, and Frameworks", "Introductory async, threading and multiprocessing concepts, installing and using external libraries, and beginning work with Python frameworks or data libraries.", "CloudOutlined"},
}

var testDifficultyPrompts = [10]string{
	"Generate one English multiple-choice question that checks whether a complete beginner recognizes the selected topic's basic purpose. Provide four concise options, exactly one correct answer, and no trick wording.",
	"Generate one English question that checks the meaning of one essential term from the selected topic. Require a one-word or one-sentence answer and avoid code that depends on unstated context.",
	"Generate one English question that asks the learner to recognize or write the simplest valid Python syntax from the selected topic. Use no more than one line of code.",
	"Generate one English code-reading question using one or two Python statements from the selected topic. Ask what the code does, not how to optimize it.",
	"Generate one English output-prediction question using no more than three lines of beginner Python. Do not use nested control flow or an unrelated advanced feature.",
	"Generate one English fill-in-the-blank question with exactly one missing token or expression and no more than three lines of code. The blank must have one unambiguous beginner-level answer.",
	"Generate one English scenario question that asks the learner to name the appropriate operation, construct, method, or approach from the selected topic. Keep the scenario concrete and short.",
	"Generate one English debugging question containing exactly one clear beginner error in no more than four lines of code. Ask the learner to identify the error and its immediate cause.",
	"Generate one English correction question that requires changing at most two lines of code. The correction must remain within the selected topic and use only beginner prerequisites.",
	"Generate one English transfer question that applies the selected topic in a new but familiar situation. Limit the expected solution to five lines and prohibit advanced syntax unrelated to the topic.",
}

func testTopicByID(id string) (TestTopic, bool) {
	for _, topic := range testTopics {
		if topic.ID == id {
			return topic, true
		}
	}
	return TestTopic{}, false
}

func testDifficultyForScore(score int) (level int, prompt string, ok bool) {
	if score < 0 || score >= len(testDifficultyPrompts) {
		return 0, "", false
	}
	return score + 1, testDifficultyPrompts[score], true
}
